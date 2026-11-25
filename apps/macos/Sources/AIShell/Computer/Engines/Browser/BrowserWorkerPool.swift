import AICore
import Foundation
import MCP
import OSLog

/// The browser workers, one generation per browser endpoint at a time (plan §4.2: a managed
/// profile, or a connected Chrome of the person's in the chrome engine's own pool): started on
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

  final class PoolEntry {
    let profileId: String
    let contextId: String
    var isRemoved = false
    var worker: BrowserWorkerProcess?
    var starting: Task<BrowserWorkerProcess, any Error>?
    var startingGeneration: Int?
    var startingWaiters:
      [UUID: CheckedContinuation<Result<BrowserWorkerProcess, BrowserWorkerCallError>, Never>] = [:]
    var inFlight = 0
    var idle: Task<Void, Never>?
    var crashes = 0
    var lastExit: ContinuousClock.Instant?

    init(profileId: String, contextId: String) {
      self.profileId = profileId
      self.contextId = contextId
    }
  }

  final class InFlightCall {
    let writes: Bool
    var sent = false
    var cancel: () -> Void = {}

    init(writes: Bool) { self.writes = writes }
  }

  static let idleGrace: Duration = .seconds(300)
  static let startTimeout: Duration = .seconds(15)
  static let cancelledMemory = 256
  static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  /// The Node and worker new generations run; running ones keep theirs until stopped.
  var binaries: EngineBinaries
  private let logDirectory: URL
  private let uploadRoot: URL
  var entries: [String: PoolEntry] = [:]
  private var lastGeneration = 0
  var cancelledOperations: Set<String> = []
  var cancelledOrder: [String] = []
  var inFlightByOperation: [String: [UUID: InFlightCall]] = [:]

  init(binaries: EngineBinaries, logDirectory: URL, uploadRoot: URL) {
    self.binaries = binaries
    self.logDirectory = logDirectory
    self.uploadRoot = uploadRoot
  }

  /// Whether the pinned Node and the add-on's worker are where this build runs them from.
  static func isStaged(_ binaries: EngineBinaries) -> Bool {
    guard let worker = binaries.browserWorker else { return false }
    return EngineBinaries.isExecutable(binaries.node) && EngineBinaries.isReadable(worker)
  }

  /// Why no worker can start from `binaries`.
  static func notStaged(_ binaries: EngineBinaries) -> ComputerFailure {
    let worker = binaries.browserWorker?.path(percentEncoded: false) ?? "not installed"
    return ComputerFailure(
      .engineFailed,
      "The browser worker cannot run (Node \(binaries.node.path(percentEncoded: false)), "
        + "worker \(worker)).")
  }

  /// The running generation of a profile's worker, if one runs for `contextId`'s browser.
  func generation(profileId: String, contextId: String) -> Int? {
    guard let entry = entries[profileId], isLive(entry), entry.contextId == contextId else {
      return nil
    }
    return entry.worker?.generation
  }

  /// Calls `tool` on the profile's worker, starting one when none runs for this browser. With
  /// `pinned`, the call goes only to that generation: element refs, versions and baselines mean
  /// nothing to another (a new worker even restarts them at the same numbers).
  func call(
    _ instance: any BrowserWorkerEndpoint, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, writes: Bool = true, pinned: Int? = nil
  ) async throws(BrowserWorkerCallError) -> (reply: BrowserWorkerReply, generation: Int) {
    let operationId = Self.operationId(of: tool, arguments: arguments)
    if isCancelled(operationId) { throw .cancelled(sent: false) }
    let profileId = instance.profileId
    if let stale = entries[profileId], stale.contextId != instance.contextId {
      // The profile's browser restarted: its worker drives a port that is gone.
      removeEntry(stale)
      Task { await Self.stop(stale) }
    }
    let entry: PoolEntry
    if let existing = entries[profileId] {
      entry = existing
    } else {
      let created = PoolEntry(profileId: profileId, contextId: instance.contextId)
      entries[profileId] = created
      entry = created
    }
    entry.inFlight += 1
    entry.idle?.cancel()
    entry.idle = nil
    let callID = UUID()
    let record = InFlightCall(writes: writes)
    if let operationId { inFlightByOperation[operationId, default: [:]][callID] = record }
    defer { removeInFlight(operationId: operationId, callID: callID) }
    let lease: Lease
    do {
      lease = try await self.lease(
        entry, instance: instance, record: record, operationId: operationId)
    } catch {
      release(entry)
      throw error
    }
    defer { release(entry) }
    if isCancelled(operationId) { throw .cancelled(sent: false) }
    if let pinned, pinned != lease.generation { throw .generationChanged }
    record.sent = true
    let worker = lease.worker
    let workerCall = Task { () async -> Result<BrowserWorkerReply, BrowserWorkerCallError> in
      do throws(BrowserWorkerCallError) {
        return .success(try await worker.call(tool, arguments, timeout: timeout))
      } catch {
        return .failure(error)
      }
    }
    record.cancel = { workerCall.cancel() }
    defer { record.cancel = {} }
    let outcome = await withTaskCancellationHandler {
      await workerCall.value
    } onCancel: {
      workerCall.cancel()
    }
    switch outcome {
    case .success(let reply):
      if isLive(entry) { entry.crashes = 0 }
      return (reply, lease.generation)
    case .failure(let error):
      switch error {
      case .exited:
        exited(entry, worker: worker)
        if writes { await worker.stop(force: true) }
      case .timedOut:
        await evict(entry, worker: worker, reason: "timed out on \(tool)", waitForExit: writes)
      case .cancelled(let sent) where writes && sent:
        await evict(entry, worker: worker, reason: "cancelled write \(tool)", waitForExit: true)
      case .failed where writes:
        await evict(entry, worker: worker, reason: "failed write \(tool)", waitForExit: true)
      case .cancelled, .rejected, .failed, .unavailable, .generationChanged:
        break
      }
      throw error
    }
  }

  /// Stops every worker and waits until each is reaped.
  func shutdownAll() async {
    let current = Array(entries.values)
    entries = [:]
    for entry in current { entry.isRemoved = true }
    for entry in current { await Self.stop(entry) }
  }

  /// Stops the worker of `profileId` while it drives `contextId`'s browser, which went away, and
  /// waits until it is reaped; the next call starts a new generation.
  func stop(profileId: String, contextId: String) async {
    guard let entry = entries[profileId], entry.contextId == contextId else { return }
    removeEntry(entry)
    await Self.stop(entry)
  }

  func isLive(_ entry: PoolEntry) -> Bool {
    !entry.isRemoved && entries[entry.profileId] === entry
  }

  func removeEntry(_ entry: PoolEntry) {
    entry.isRemoved = true
    if entries[entry.profileId] === entry { entries[entry.profileId] = nil }
    entry.idle?.cancel()
    entry.idle = nil
  }

  private static func stop(_ entry: PoolEntry) async {
    entry.isRemoved = true
    entry.idle?.cancel()
    entry.idle = nil
    let starting = entry.starting
    entry.starting = nil
    entry.startingGeneration = nil
    let waiters = entry.startingWaiters
    entry.startingWaiters = [:]
    let worker = entry.worker
    entry.worker = nil
    starting?.cancel()
    for continuation in waiters.values {
      continuation.resume(returning: .failure(.unavailable("The browser worker stopped.")))
    }
    if let worker {
      await worker.stop()
    }
    if let started = try? await starting?.value {
      await started.stop(force: true)
    }
  }

  // MARK: Generations

  private func lease(
    _ entry: PoolEntry, instance: any BrowserWorkerEndpoint, record: InFlightCall,
    operationId: String?
  ) async throws(BrowserWorkerCallError) -> Lease {
    guard isLive(entry) else { throw .unavailable("The browser worker stopped.") }
    while let worker = entry.worker {
      if await worker.isRunning, isLive(entry), entry.worker === worker {
        return Lease(worker: worker, generation: worker.generation)
      }
      guard isLive(entry) else { throw .unavailable("The browser worker stopped.") }
      if entry.worker === worker { exited(entry, worker: worker) }
    }
    if isCancelled(operationId) { throw .cancelled(sent: false) }
    if entry.starting == nil {
      guard let script = binaries.browserWorker else {
        throw .unavailable("The browser worker add-on is not installed.")
      }
      lastGeneration += 1
      let launch = BrowserWorkerProcess.Launch(
        node: binaries.node, worker: script, webSocket: instance.webSocketURL,
        channel: instance.channel, uploadRoot: uploadRoot,
        log: logDirectory.appending(
          path: "\(entry.profileId).log", directoryHint: .notDirectory))
      let generation = lastGeneration
      let wait = restartWait(entry)
      entry.startingGeneration = generation
      entry.starting = Task { [weak self] in
        do {
          if wait > .zero { try await Task.sleep(for: wait) }
          let worker = try await BrowserWorkerProcess.start(
            launch, generation: generation, timeout: Self.startTimeout)
          self?.finishStart(entry, generation: generation, result: .success(worker))
          return worker
        } catch {
          self?.finishStart(entry, generation: generation, result: .failure(error))
          throw error
        }
      }
    }
    let waiterID = UUID()
    record.cancel = { [weak self] in self?.cancelLeaseWaiter(entry, id: waiterID) }
    defer { record.cancel = {} }
    let outcome = await withTaskCancellationHandler {
      await withCheckedContinuation {
        (
          continuation: CheckedContinuation<
            Result<BrowserWorkerProcess, BrowserWorkerCallError>, Never
          >
        )
        in
        if isCancelled(operationId) {
          continuation.resume(returning: .failure(.cancelled(sent: false)))
          return
        }
        guard isLive(entry) else {
          continuation.resume(returning: .failure(.unavailable("The browser worker stopped.")))
          return
        }
        if let worker = entry.worker {
          continuation.resume(returning: .success(worker))
          return
        }
        guard entry.starting != nil else {
          continuation.resume(returning: .failure(.unavailable("The browser worker stopped.")))
          return
        }
        entry.startingWaiters[waiterID] = continuation
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.cancelLeaseWaiter(entry, id: waiterID) }
    }
    switch outcome {
    case .success(let worker):
      guard isLive(entry) else { throw .unavailable("The browser worker stopped.") }
      return Lease(worker: worker, generation: worker.generation)
    case .failure(let error):
      throw error
    }
  }
}
