import AICore
import Foundation
import MCP
import OSLog

/// The browser workers, one generation per managed profile at a time (plan §4.2): started on
/// demand, kept while calls use them, stopped after ``idleGrace`` without a call. A worker that
/// exits on its own ends its generation; the next call starts a new one after a bounded backoff
/// (``ManagedChromeLaunch/restartDelay(afterCrashes:)``) and never replays the call whose
/// outcome was lost. A new generation makes every observation of the old one stale, since the
/// worker's element refs, versions and baselines restart with it.
final class BrowserWorkerPool {
  /// A worker generation and the browser it drives.
  struct Lease {
    let worker: BrowserWorkerProcess
    let generation: Int
  }

  private struct Entry {
    var contextId: String
    var worker: BrowserWorkerProcess?
    var starting: Task<BrowserWorkerProcess, any Error>?
    var inFlight = 0
    var idle: Task<Void, Never>?
    var crashes = 0
    var lastExit: ContinuousClock.Instant?
  }

  static let idleGrace: Duration = .seconds(300)
  static let startTimeout: Duration = .seconds(15)
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  /// The Node and worker new generations run; running ones keep theirs until stopped.
  var binaries: EngineBinaries
  private let logDirectory: URL
  private let uploadRoot: URL
  private var entries: [String: Entry] = [:]
  private var lastGeneration = 0

  init(binaries: EngineBinaries, logDirectory: URL, uploadRoot: URL) {
    self.binaries = binaries
    self.logDirectory = logDirectory
    self.uploadRoot = uploadRoot
  }

  /// The running generation of a profile's worker, if one runs for `contextId`'s browser.
  func generation(profileId: String, contextId: String) -> Int? {
    guard let entry = entries[profileId], entry.contextId == contextId else { return nil }
    return entry.worker?.generation
  }

  /// Calls `tool` on the profile's worker, starting one when none runs for this browser. With
  /// `pinned`, the call goes only to that generation: element refs, versions and baselines mean
  /// nothing to another (a new worker even restarts them at the same numbers).
  func call(
    _ instance: ManagedChromeInstance, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, pinned: Int? = nil
  ) async throws(BrowserWorkerCallError) -> (reply: BrowserWorkerReply, generation: Int) {
    let profileId = instance.profileId
    if let entry = entries[profileId], entry.contextId != instance.contextId {
      // The profile's browser restarted: its worker drives a port that is gone.
      entries[profileId] = nil
      entry.idle?.cancel()
      if let worker = entry.worker { Task { await worker.stop() } }
    }
    entries[profileId, default: Entry(contextId: instance.contextId)].inFlight += 1
    entries[profileId]?.idle?.cancel()
    let lease: Lease
    do {
      lease = try await self.lease(instance)
    } catch {
      release(profileId, generation: nil)
      throw error
    }
    defer { release(profileId, generation: lease.generation) }
    if let pinned, pinned != lease.generation { throw .generationChanged }
    do {
      let reply = try await lease.worker.call(tool, arguments, timeout: timeout)
      entries[profileId]?.crashes = 0
      return (reply, lease.generation)
    } catch {
      if error == .exited { exited(profileId, generation: lease.generation) }
      throw error
    }
  }

  /// Asks every running worker to abort the calls carrying `operationId`.
  func cancel(operationId: String) async {
    let workers = entries.values.compactMap(\.worker)
    for worker in workers {
      _ = try? await worker.call(
        "cancel", ["operationId": .string(operationId)], timeout: .seconds(3))
    }
  }

  /// Stops every worker and waits until each is reaped.
  func shutdownAll() async {
    let current = entries
    entries = [:]
    for entry in current.values {
      entry.idle?.cancel()
      entry.starting?.cancel()
      if let worker = entry.worker {
        await worker.stop()
      } else if let started = try? await entry.starting?.value {
        await started.stop()
      }
    }
  }

  // MARK: Generations

  private func lease(_ instance: ManagedChromeInstance) async throws(BrowserWorkerCallError)
    -> Lease
  {
    let profileId = instance.profileId
    var entry = entries[profileId] ?? Entry(contextId: instance.contextId)
    if let worker = entry.worker {
      if await worker.isRunning { return Lease(worker: worker, generation: worker.generation) }
      exited(profileId, generation: worker.generation)
      entry = entries[profileId] ?? entry
    }
    let task: Task<BrowserWorkerProcess, any Error>
    if let starting = entry.starting {
      task = starting
    } else {
      guard let script = binaries.browserWorker else {
        throw .unavailable("The browser worker add-on is not installed.")
      }
      lastGeneration += 1
      let launch = BrowserWorkerProcess.Launch(
        node: binaries.node, worker: script, webSocket: instance.webSocketURL,
        uploadRoot: uploadRoot,
        log: logDirectory.appending(path: "\(profileId).log", directoryHint: .notDirectory))
      let generation = lastGeneration
      let wait = restartWait(entry)
      task = Task {
        if wait > .zero { try await Task.sleep(for: wait) }
        return try await BrowserWorkerProcess.start(
          launch, generation: generation, timeout: Self.startTimeout)
      }
      entry.starting = task
      entries[profileId] = entry
    }
    do {
      let worker = try await task.value
      if entries[profileId]?.starting == task {
        entries[profileId]?.starting = nil
        entries[profileId]?.worker = worker
      }
      return Lease(worker: worker, generation: worker.generation)
    } catch {
      if entries[profileId]?.starting == task { entries[profileId]?.starting = nil }
      Self.log.error(
        "The browser worker did not start: \(String(describing: error), privacy: .public)")
      throw .unavailable("The browser worker did not start: \(error.localizedDescription)")
    }
  }

  /// How long a start waits after crashes: the backoff minus the time since the last exit.
  private func restartWait(_ entry: Entry) -> Duration {
    guard let lastExit = entry.lastExit else { return .zero }
    let elapsed = ContinuousClock.now - lastExit
    let remaining = ManagedChromeLaunch.restartDelay(afterCrashes: entry.crashes) - elapsed
    return max(.zero, remaining)
  }

  /// A worker exited on its own: its generation ends and the next start backs off.
  private func exited(_ profileId: String, generation: Int) {
    guard var entry = entries[profileId], entry.worker?.generation == generation else { return }
    if let worker = entry.worker { Task { await worker.stop() } }
    entry.worker = nil
    entry.crashes += 1
    entry.lastExit = .now
    entries[profileId] = entry
    Self.log.error("The browser worker of a managed profile exited.")
  }

  private func release(_ profileId: String, generation: Int?) {
    guard var entry = entries[profileId] else { return }
    entry.inFlight = max(0, entry.inFlight - 1)
    if entry.inFlight == 0, let worker = entry.worker,
      generation == nil || worker.generation == generation
    {
      let running = worker.generation
      entry.idle?.cancel()
      entry.idle = Task { [weak self] in
        try? await Task.sleep(for: Self.idleGrace)
        guard !Task.isCancelled else { return }
        self?.stopIdle(profileId, generation: running)
      }
    }
    entries[profileId] = entry
  }

  private func stopIdle(_ profileId: String, generation: Int) {
    guard let entry = entries[profileId], entry.inFlight == 0,
      let worker = entry.worker, worker.generation == generation
    else { return }
    entries[profileId] = nil
    Task { await worker.stop() }
  }
}
