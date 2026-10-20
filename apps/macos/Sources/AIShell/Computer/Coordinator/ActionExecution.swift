import AICore
import Foundation

/// One `act` in flight (plan §6.4). A stop — the service's cancel, the request's deadline, a new
/// service epoch, quitting — closes the action to further steps and reaches whatever it waits
/// on: the resource claim is withdrawn, the running step is cancelled through its engine and
/// given ``convergenceLimit`` to end. A step that does not end by then is reported with an
/// unknown effect, and its resources stay claimed until it really ends, so no other operation
/// writes to a target whose state is not known.
final class ActionExecution {
  /// How long a cancelled step may take to end; below the service's ten-second wait for the
  /// terminal reply.
  static let convergenceLimit: Duration = .seconds(7)

  enum StepEnd {
    case finished(Result<EngineStepOutcome, ComputerFailure>)
    /// The step did not end in time; `remaining` ends when it does.
    case unconverged(remaining: Task<Void, Never>)
  }

  let runId: String
  let operationId: String
  let actionId: String
  let serviceEpoch: String
  /// The reply every request for this action gets, including a repeated one that joins it.
  var reply: Task<HostReplyWire, Never>?
  /// Why the action must stop; nil while it may go on.
  private(set) var stop: ComputerFailure?
  private var stopHandler: (() -> Void)?

  init(runId: String, operationId: String, actionId: String, serviceEpoch: String) {
    self.runId = runId
    self.operationId = operationId
    self.actionId = actionId
    self.serviceEpoch = serviceEpoch
  }

  /// Stops the action; only the first reason counts.
  func requestStop(_ failure: ComputerFailure) {
    guard stop == nil else { return }
    stop = failure
    let handler = stopHandler
    stopHandler = nil
    handler?()
  }

  /// Waits for the action's resources, unless it is stopped first.
  func claim(
    _ resources: Set<DeviceResource>, on arbiter: DeviceArbiter,
    deadline: ContinuousClock.Instant
  ) async -> Result<ResourceClaim, ClaimRefusal> {
    if stop != nil { return .failure(.cancelled) }
    let owner = ClaimOwner.computer(ComputerOperation(runId: runId, operationId: operationId))
    let wait = Task { () async -> Result<ResourceClaim, ClaimRefusal> in
      do throws(ClaimRefusal) {
        return .success(try await arbiter.claim(resources, owner: owner, deadline: deadline))
      } catch {
        return .failure(error)
      }
    }
    stopHandler = { wait.cancel() }
    let result = await wait.value
    stopHandler = nil
    return result
  }

  /// Cancellation reaches the active driver call, but the resource remains claimed until the
  /// engine returns. Its context prevents a late read from publishing a usable observation.
  func observe(
    _ operation: ObserveOperationWire, engine: any ComputerEngine, ref: TargetRefWire,
    deadline: ContinuousClock.Instant
  ) async -> Result<ObservationWire, ComputerFailure> {
    if let stop { return .failure(stop) }
    let context = EngineObserveContext(
      operationId: operationId, deadline: deadline,
      isStopping: { [weak self] in self?.stop != nil })
    let running = Task { () async -> Result<ObservationWire, ComputerFailure> in
      do throws(ComputerFailure) {
        try context.check()
        let observation = try await engine.observe(ref, operation, context: context)
        try context.check()
        return .success(observation)
      } catch { return .failure(error) }
    }
    let operationId = operationId
    stopHandler = { Task { await engine.cancel(operationId: operationId) } }
    let result = await running.value
    stopHandler = nil
    if let stop { return .failure(stop) }
    return result
  }

  /// Runs one step to its end, or, once stopped, cancels it and waits at most
  /// ``convergenceLimit`` for it to end.
  func perform(
    _ step: ComputerStepWire, engine: any ComputerEngine, ref: TargetRefWire,
    observation: ObservationRefWire, context: EngineStepContext
  ) async -> StepEnd {
    let running = Task { () async -> Result<EngineStepOutcome, ComputerFailure> in
      do throws(ComputerFailure) {
        return .success(
          try await engine.perform(step, on: ref, observation: observation, context: context))
      } catch {
        return .failure(error)
      }
    }
    let first = FirstResult()
    let operationId = operationId
    let ended = await withCheckedContinuation { continuation in
      first.continuation = continuation
      Task { first.resume(await running.value) }
      let converge = {
        Task {
          await engine.cancel(operationId: operationId)
          try? await Task.sleep(for: Self.convergenceLimit)
          first.resume(nil)
        }
      }
      if stop != nil {
        _ = converge()
      } else {
        stopHandler = { _ = converge() }
      }
    }
    stopHandler = nil
    guard let ended else { return .unconverged(remaining: Task { _ = await running.value }) }
    if case .failure(let failure) = ended, failure.code == .cancelled, let stop {
      return .finished(
        .failure(
          ComputerFailure(
            stop.code, stop.message, mayHaveDispatched: failure.mayHaveDispatched)))
    }
    return .finished(ended)
  }
}

/// Resumes a continuation with whichever answer comes first. Not generic: as a generic
/// main-actor class, Swift 6.2.4's optimizer crashes on its deinit (EarlyPerfInliner) in Release.
private final class FirstResult {
  typealias Value = Result<EngineStepOutcome, ComputerFailure>

  var continuation: CheckedContinuation<Value?, Never>?

  func resume(_ value: Value?) {
    continuation?.resume(returning: value)
    continuation = nil
  }
}
