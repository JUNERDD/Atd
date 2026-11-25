import AICore
import Foundation
import MCP
import OSLog

/// The worker's calls as the host's failures, for everything that talks to a profile's worker:
/// the engine's steps and reads, and the access operation that opens a website's page.
extension BrowserWorkerPool {
  /// ``call(_:_:_:timeout:pinned:)`` with the call's own failures as the host's. `writes` says
  /// whether the tool can change the page, which decides whether a call that lost its reply may
  /// have reached it.
  func invoke(
    _ instance: any BrowserWorkerEndpoint, _ tool: String, _ arguments: [String: Value],
    timeout: Duration, writes: Bool, pinned: Int? = nil
  ) async throws(ComputerFailure) -> (reply: BrowserWorkerReply, generation: Int) {
    do {
      return try await call(
        instance, tool, arguments, timeout: timeout, writes: writes, pinned: pinned)
    } catch {
      switch error {
      case .generationChanged:
        throw ComputerFailure(
          .staleObservation, "The browser worker restarted since the observation; observe again.")
      case .exited:
        throw ComputerFailure(
          .engineFailed, "The browser worker exited during \(tool).", mayHaveDispatched: writes)
      case .timedOut:
        throw ComputerFailure(
          .timeout, "The browser worker did not answer \(tool) in time.",
          mayHaveDispatched: writes)
      case .cancelled(let sent):
        throw ComputerFailure(
          .cancelled, "The browser worker call \(tool) was cancelled.",
          mayHaveDispatched: sent && writes)
      case .rejected(let message):
        throw ComputerFailure(.unsupported, "The browser worker refused \(tool): \(message)")
      case .failed(let message):
        throw ComputerFailure(.engineFailed, message, mayHaveDispatched: writes)
      case .unavailable(let message):
        throw ComputerFailure(.engineFailed, message)
      }
    }
  }

  /// Cancels any call for `operationId` still waiting on startup or running read-only work, and
  /// asks every running worker to abort in-flight calls carrying `operationId`.
  func cancel(operationId: String) async {
    rememberCancelled(operationId)
    let calls = inFlightByOperation[operationId].map { Array($0.values) } ?? []
    let hasSentWrite = calls.contains { $0.writes && $0.sent }
    for call in calls where !call.writes || !call.sent { call.cancel() }
    let active = entries.values.compactMap { entry in
      entry.worker.map { (entry, $0) }
    }
    guard !active.isEmpty else { return }
    await withTaskGroup(of: (Int, BrowserWorkerCallError?).self) { group in
      for (index, (_, worker)) in active.enumerated() {
        group.addTask {
          do {
            _ = try await worker.call(
              "cancel", ["operationId": .string(operationId)], timeout: .seconds(3))
            return (index, nil)
          } catch {
            return (index, error as? BrowserWorkerCallError)
          }
        }
      }
      for await (index, error) in group {
        let (entry, worker) = active[index]
        if error == .timedOut {
          await evict(
            entry, worker: worker, reason: "timed out on cancel", waitForExit: hasSentWrite)
        } else if error == .exited {
          exited(entry, worker: worker)
          if hasSentWrite { await worker.stop(force: true) }
        }
      }
    }
  }

  /// A worker exited on its own: its generation ends and the next start backs off.
  func exited(_ entry: PoolEntry, worker: BrowserWorkerProcess) {
    guard isLive(entry), entry.worker === worker else { return }
    entry.worker = nil
    entry.crashes += 1
    entry.lastExit = .now
    Task { await worker.stop() }
    Self.log.error("A browser worker exited.")
  }

  /// Evicts an unresponsive worker generation and force-stops it. Write paths (`waitForExit`)
  /// await process reaping so `.page` claims never release while buffered CDP writes could run.
  func evict(
    _ entry: PoolEntry, worker: BrowserWorkerProcess, reason: String, waitForExit: Bool
  ) async {
    if isLive(entry), entry.worker === worker {
      entry.worker = nil
      entry.idle?.cancel()
      entry.idle = nil
      Self.log.error(
        "Evicting browser worker generation \(worker.generation): \(reason, privacy: .public)")
    }
    if waitForExit {
      await worker.stop(force: true)
    } else {
      Task { await worker.stop(force: true) }
    }
  }

  func rememberCancelled(_ operationId: String) {
    guard cancelledOperations.insert(operationId).inserted else { return }
    cancelledOrder.append(operationId)
    if cancelledOrder.count > Self.cancelledMemory {
      cancelledOperations.remove(cancelledOrder.removeFirst())
    }
  }

  func isCancelled(_ operationId: String?) -> Bool {
    Task.isCancelled || operationId.map(cancelledOperations.contains) == true
  }

  func removeInFlight(operationId: String?, callID: UUID) {
    guard let operationId else { return }
    inFlightByOperation[operationId]?[callID] = nil
    if inFlightByOperation[operationId]?.isEmpty == true {
      inFlightByOperation[operationId] = nil
    }
  }

  static func operationId(of tool: String, arguments: [String: Value]) -> String? {
    guard tool != "cancel", case .string(let id)? = arguments["operationId"] else { return nil }
    return id
  }

  func finishStart(
    _ entry: PoolEntry, generation: Int, result: Result<BrowserWorkerProcess, any Error>
  ) {
    guard isLive(entry), entry.startingGeneration == generation else {
      if case .success(let worker) = result { Task { await worker.stop(force: true) } }
      return
    }
    let waiters = entry.startingWaiters
    entry.starting = nil
    entry.startingGeneration = nil
    entry.startingWaiters = [:]
    switch result {
    case .success(let worker):
      entry.worker = worker
      for continuation in waiters.values { continuation.resume(returning: .success(worker)) }
      armIdleIfUnused(entry)
    case .failure(let error):
      Self.log.error(
        "The browser worker did not start: \(String(describing: error), privacy: .public)")
      let mapped: BrowserWorkerCallError =
        if case BrowserWorkerCallError.cancelled = error {
          .cancelled(sent: false)
        } else {
          .unavailable("The browser worker did not start: \(error.localizedDescription)")
        }
      for continuation in waiters.values { continuation.resume(returning: .failure(mapped)) }
    }
  }

  func cancelLeaseWaiter(_ entry: PoolEntry, id: UUID) {
    guard isLive(entry), let continuation = entry.startingWaiters.removeValue(forKey: id) else {
      return
    }
    if entry.startingWaiters.isEmpty {
      entry.starting?.cancel()
      entry.starting = nil
      entry.startingGeneration = nil
    }
    continuation.resume(returning: .failure(.cancelled(sent: false)))
  }

  /// How long a start waits after crashes: the backoff minus the time since the last exit.
  func restartWait(_ entry: PoolEntry) -> Duration {
    guard let lastExit = entry.lastExit else { return .zero }
    let elapsed = ContinuousClock.now - lastExit
    let remaining = ManagedChromeLaunch.restartDelay(afterCrashes: entry.crashes) - elapsed
    return max(.zero, remaining)
  }

  func release(_ entry: PoolEntry) {
    entry.inFlight = max(0, entry.inFlight - 1)
    armIdleIfUnused(entry)
  }

  func armIdleIfUnused(_ entry: PoolEntry) {
    guard isLive(entry), entry.inFlight == 0, entry.starting == nil,
      entry.startingWaiters.isEmpty, let worker = entry.worker
    else { return }
    let running = worker.generation
    entry.idle?.cancel()
    entry.idle = Task { [weak self, weak entry] in
      try? await Task.sleep(for: Self.idleGrace)
      guard !Task.isCancelled, let self, let entry else { return }
      self.stopIdle(entry, generation: running)
    }
  }

  func stopIdle(_ entry: PoolEntry, generation: Int) {
    guard isLive(entry), entry.inFlight == 0, entry.starting == nil,
      entry.startingWaiters.isEmpty, let worker = entry.worker, worker.generation == generation
    else { return }
    removeEntry(entry)
    entry.worker = nil
    Task { await worker.stop() }
  }
}

extension BrowserWorkerReply {
  /// This reply when the call succeeded, or its failure with the worker's own word on whether it
  /// dispatched. The worker's `notFound` names the page (refs always come from an observation),
  /// so the page closed: the target changed.
  func checked(_ tool: String) throws(ComputerFailure) -> BrowserWorkerReply {
    guard !ok else { return self }
    let code = error.map { Self.hostCode($0.code) } ?? .engineFailed
    let message = error?.message ?? "The browser worker failed \(tool)."
    throw ComputerFailure(
      code == .notFound ? .targetChanged : code, message, mayHaveDispatched: dispatched)
  }
}
