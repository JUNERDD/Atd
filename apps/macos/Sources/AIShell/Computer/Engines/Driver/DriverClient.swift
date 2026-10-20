import AIComputerDriverKit
import AICore
import Foundation
import OSLog

/// Why a driver request produced no answer of its own.
enum DriverClientFailure: Error, Equatable, Sendable {
  /// No driver runs, or it was gone before the request was written: nothing was sent.
  case notRunning
  /// The driver could not be started.
  case launch(String)
  /// The driver exited, or its stream broke, with the request in flight.
  case exited
  /// No answer within the request's limit.
  case timedOut
  /// The caller stopped waiting; `sent` says whether the request had reached the driver.
  case cancelled(sent: Bool)
  /// The driver refused or failed the request.
  case refused(DriverFailure)
  /// An answer of another shape than the request asked for.
  case malformed(String)
}

/// The shell's connection to one `atd-computer-driver` at a time (driver protocol v1): it spawns
/// the helper (``DriverProcess``), writes length-prefixed request frames, correlates the
/// responses by id, bounds each request, and reads the capabilities from the `ready` event the
/// driver sends first. Every start is a new generation, stamped into the driver's events; the
/// engine numbers them.
///
/// A driver that exits on its own (a crash in a private call, a framing error) ends its
/// generation: requests in flight fail `exited` (a `perform` may then have dispatched), `onExit`
/// reports the generation, and the next start spawns a new one. A `perform` that outlives its
/// limit means the driver broke its own deadline, so it is killed at once rather than left to
/// send input later; a read that outlives its limit is abandoned with a `cancel` frame, since
/// only its target's executor is held up.
actor DriverClient {
  private struct Pending {
    let continuation: CheckedContinuation<Result<DriverResult, DriverClientFailure>, Never>
    let kind: String
    let writes: Bool
    var timer: Task<Void, Never>?
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer-driver")

  private let onExit: @Sendable (Int) -> Void
  private var process: DriverProcess?
  private var generation: Int?
  private var waitingForReady: CheckedContinuation<DriverHello?, Never>?
  private var pending: [Int: Pending] = [:]
  private var nextId = 0

  init(onExit: @escaping @Sendable (Int) -> Void) {
    self.onExit = onExit
  }

  /// The running driver's process, whose events the host's input monitor never takes for the
  /// person's; nil while none runs.
  var processIdentifier: pid_t? { process?.isRunning == true ? process?.processIdentifier : nil }

  /// Spawns a driver for `launch` (stopping one that still runs) and returns its `ready`
  /// announcement, which must arrive within `timeout`.
  func start(_ launch: DriverLaunch, timeout: Duration) async throws(DriverClientFailure)
    -> DriverHello
  {
    await stop()
    let started: (DriverProcess, AsyncStream<Data>)
    do {
      started = try DriverProcess.launch(launch)
    } catch {
      throw .launch("\(launch.executable.lastPathComponent): \(error.localizedDescription)")
    }
    let (driver, chunks) = started
    process = driver
    generation = launch.generation
    Task { await self.consume(chunks, generation: launch.generation) }
    let timer = Task {
      try? await Task.sleep(for: timeout)
      guard !Task.isCancelled else { return }
      self.announced(nil, generation: launch.generation)
    }
    let announced = await withCheckedContinuation { waitingForReady = $0 }
    timer.cancel()
    guard let announced, generation == launch.generation else {
      await stop()
      throw .launch("The driver did not announce itself within \(timeout).")
    }
    return announced
  }

  /// Sends `request` and waits for its answer, at most `timeout`. Cancelling the calling task
  /// stops the wait and tells the driver (`cancel`), which cannot interrupt a primitive it began.
  func send(_ request: DriverRequest, timeout: Duration) async
    -> Result<DriverResult, DriverClientFailure>
  {
    guard let process, process.isRunning else { return .failure(.notRunning) }
    if Task.isCancelled { return .failure(.cancelled(sent: false)) }
    nextId += 1
    let id = nextId
    let frame: Data
    do {
      frame = try DriverFrameCodec.encode(DriverRequestFrame(id: id, request: request))
    } catch {
      return .failure(.malformed("The request could not be encoded: \(error)"))
    }
    let writes = if case .perform = request { true } else { false }
    return await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        pending[id] = Pending(continuation: continuation, kind: request.kind, writes: writes)
        guard process.write(frame) else {
          complete(id, .failure(.notRunning))
          return
        }
        pending[id]?.timer = Task {
          try? await Task.sleep(for: timeout)
          guard !Task.isCancelled else { return }
          self.expire(id)
        }
      }
    } onCancel: {
      Task { await self.abandon(id) }
    }
  }

  /// Stops the running driver (EOF on its stdin, then signals) and fails what is in flight.
  func stop() async {
    guard let driver = process else { return }
    process = nil
    generation = nil
    failAll(.exited)
    await driver.stop()
  }

  // MARK: Incoming

  private func consume(_ chunks: AsyncStream<Data>, generation owner: Int) async {
    var decoder = DriverFrameCodec.Decoder()
    for await chunk in chunks {
      guard generation == owner else { return }
      do {
        for frame in try decoder.append(chunk) { receive(frame, generation: owner) }
      } catch {
        Self.log.error("Driver \(owner) sent a malformed frame: \(String(describing: error))")
        process?.terminateNow()
        break
      }
    }
    ended(generation: owner)
  }

  private func receive(_ outgoing: DriverOutgoing, generation owner: Int) {
    switch outgoing {
    case .event(.ready(let announced)):
      self.announced(announced, generation: owner)
    case .response(let frame):
      if let failure = frame.failure {
        complete(frame.id, .failure(.refused(failure)))
      } else if let result = frame.result {
        complete(frame.id, .success(result))
      } else {
        complete(frame.id, .failure(.malformed("A response carried neither result nor failure.")))
      }
    }
  }

  private func announced(_ hello: DriverHello?, generation owner: Int) {
    guard generation == owner, let waiting = waitingForReady else { return }
    waitingForReady = nil
    waiting.resume(returning: hello)
  }

  /// The driver's stdout reached EOF: its generation is over.
  private func ended(generation owner: Int) {
    announced(nil, generation: owner)
    guard generation == owner else { return }
    Self.log.notice("Driver generation \(owner) exited.")
    process = nil
    generation = nil
    failAll(.exited)
    onExit(owner)
  }

  // MARK: Pending requests

  private func complete(_ id: Int, _ result: Result<DriverResult, DriverClientFailure>) {
    guard let entry = pending.removeValue(forKey: id) else { return }
    entry.timer?.cancel()
    entry.continuation.resume(returning: result)
  }

  private func expire(_ id: Int) {
    guard let entry = pending[id] else { return }
    complete(id, .failure(.timedOut))
    if entry.writes {
      Self.log.error("A driver \(entry.kind) outlived its limit; the driver is stopped.")
      process?.terminateNow()
    } else {
      tellDriverToCancel(id)
    }
  }

  private func abandon(_ id: Int) {
    guard pending[id] != nil else { return }
    complete(id, .failure(.cancelled(sent: true)))
    tellDriverToCancel(id)
  }

  /// Acknowledged by the driver only; it lets a stuck call finish on its own worker.
  private func tellDriverToCancel(_ id: Int) {
    nextId += 1
    let request = DriverRequestFrame(
      id: nextId, request: .cancel(DriverCancelRequest(cancelId: id)))
    guard let process, let frame = try? DriverFrameCodec.encode(request) else { return }
    _ = process.write(frame)
  }

  private func failAll(_ failure: DriverClientFailure) {
    for id in pending.keys.sorted() { complete(id, .failure(failure)) }
  }
}

extension DriverRequest {
  /// The request's type, for logs.
  nonisolated var kind: String {
    switch self {
    case .hello: "hello"
    case .probe: "probe"
    case .prepare: "prepare"
    case .release: "release"
    case .snapshot: "snapshot"
    case .perform: "perform"
    case .capture: "capture"
    case .cancel: "cancel"
    }
  }
}
