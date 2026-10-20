import AICore
import Foundation

/// Reads retain their claim through cancellation until the underlying engine has returned.
extension ComputerCoordinator {
  func observe(_ request: HostRequestWire, _ operation: ObserveOperationWire) async
    -> HostReplyWire
  {
    if let refusal = operation.refusal { return .failed(request, .unsupported, refusal) }
    let envelope = request.envelope
    let ref = operation.targetRef
    let screenshot = operation.include.screenshot
    let deadline = deadline(of: request)
    let engine: any ComputerEngine
    do throws(ComputerFailure) {
      engine = try usableEngine(
        try targets.kind(of: ref.id), request: request, screenshot: screenshot)
      _ = try targets.current(ref, engineGeneration: engine.generation)
    } catch {
      return HostReplyWire(identity: request.identity, outcome: .failed(error.wire))
    }
    // An observation queues with the target's writes (plan §6.2), but holds it only to read.
    let execution = ActionExecution(
      runId: envelope.runId, operationId: envelope.operationId, actionId: request.requestId,
      serviceEpoch: request.identity.serviceEpoch)
    // Registered so a cancel, a new service epoch or quitting withdraws its claim wait.
    let key = "observe:" + request.requestId
    executions[key] = execution
    let watchdog = Task { [weak execution] in
      try? await Task.sleep(until: deadline, clock: .continuous)
      guard !Task.isCancelled else { return }
      execution?.requestStop(ComputerFailure(.timeout, "The observation deadline passed."))
    }
    defer {
      watchdog.cancel()
      executions[key] = nil
      refreshIfIdle()
    }
    let claim: ResourceClaim
    switch await execution.claim(
      engine.resources(for: ref), on: arbiter, deadline: deadline)
    {
    case .success(let granted): claim = granted
    case .failure(let refusal):
      return HostReplyWire(identity: request.identity, outcome: .failed(Self.wire(refusal)))
    }
    defer { claim.release() }
    if let stop = execution.stop {
      return HostReplyWire(identity: request.identity, outcome: .failed(stop.wire))
    }
    // The driver may advance tokens even when the caller cancels before receiving them.
    targets.invalidateObservation(refId: ref.id)
    let observed: Result<ObservationWire, ComputerFailure> =
      if screenshot {
        await pointer.hideAll {
          await execution.observe(operation, engine: engine, ref: ref, deadline: deadline)
        }
      } else {
        await execution.observe(operation, engine: engine, ref: ref, deadline: deadline)
      }
    if let stop = execution.stop {
      engine.invalidateObservation(ref)
      targets.invalidateObservation(refId: ref.id)
      return HostReplyWire(identity: request.identity, outcome: .failed(stop.wire))
    }
    guard ContinuousClock.now < deadline else {
      engine.invalidateObservation(ref)
      targets.invalidateObservation(refId: ref.id)
      return .failed(request, .timeout, "The observation deadline passed.")
    }
    switch observed {
    case .success(let observation):
      guard observation.ref.targetRefId == ref.id else {
        return .failed(request, .engineFailed, "The engine observed another target.")
      }
      targets.observed(observation, refId: ref.id)
      await registerPreview(request, ref: ref, observation: observation, engine: engine)
      if execution.stop != nil || ContinuousClock.now >= deadline {
        engine.invalidateObservation(ref)
        targets.invalidateObservation(refId: ref.id)
        previews.remove(refId: ref.id)
        let failure =
          execution.stop ?? ComputerFailure(.timeout, "The observation deadline passed.")
        return HostReplyWire(identity: request.identity, outcome: .failed(failure.wire))
      }
      return .ok(request, .observation(observation))
    case .failure(let failure):
      invalidate(after: failure, refId: ref.id)
      return HostReplyWire(identity: request.identity, outcome: .failed(failure.wire))
    }
  }
}
