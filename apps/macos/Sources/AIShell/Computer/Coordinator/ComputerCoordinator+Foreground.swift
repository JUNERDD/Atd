import AICore
import Foundation

/// The foreground fallback (docs/plans/2026-10-21-foreground-fallback.md). In a request that
/// allows it (``ForegroundPolicy/allows(_:)``), a click, key, type or drag step that every
/// background route refused, before anything was sent and for a reason the foreground gets past,
/// is done again in the foreground within the same action (``ForegroundExecutor``); the model never
/// asks for it. The target comes to the front, the input still goes out through the engine's own
/// process-targeted route, never moving the person's pointer (R13), and what the person had in
/// front when the act step began is put back. Its own activation and raise are no disturbance once
/// put back, it never switches a background route off, and a restore that fails is the agent's
/// disturbance, which ends the action `disturbed`. In such a request, a background step that
/// raised or activated the target over the person's app is put back the same way (R7): the action
/// then goes on, with the disturbance listed as repaired and its route still switched off.
extension ComputerCoordinator {
  /// The step done again in the foreground when `end` is a refusal the fallback takes, with the
  /// receipt of what it changed and put back; nil when the fallback does not apply. `before` is
  /// what the person had in front when the act step began, before its background attempt, which
  /// the foreground puts back.
  func foreground(
    after end: ActionExecution.StepEnd, step: ComputerStepWire, request: HostRequestWire,
    engine: any ComputerEngine, ref: TargetRefWire, observation: ObservationRefWire,
    context: EngineStepContext, execution: ActionExecution, before: DisturbanceSnapshot?
  ) async -> (end: ActionExecution.StepEnd, receipt: EngineInputReceipt?)? {
    guard ForegroundPolicy.allows(request.envelope), execution.stop == nil, let before,
      case .finished(.failure(let refusal)) = end,
      ForegroundPolicy.takes(
        step, refused: refusal.code, reason: refusal.reason,
        mayHaveDispatched: refusal.mayHaveDispatched)
    else { return nil }
    let record = ForegroundRecord()
    let executor = ForegroundExecutor(arbiter: arbiter, disturbance: disturbance)
    let foreground = ForegroundExecutor.Context(
      owner: .computer(
        ComputerOperation(runId: execution.runId, operationId: execution.operationId)),
      before: before, deadline: context.deadline, isStopping: context.isStopping,
      report: context.report, phases: context.phases)
    let ended = await execution.perform(engine: engine) {
      () async throws(ComputerFailure) -> EngineStepOutcome in
      try await engine.foreground(
        step, on: ref, observation: observation, refusal: refusal, context: context
      ) { (plan: ForegroundPlan) async throws(ComputerFailure) -> EngineStepOutcome in
        try await executor.run(plan, context: foreground, record: record)
      }
    }
    Self.log.notice(
      "Foreground fallback for a \(step.kind.rawValue, privacy: .public) step after \(refusal.reason?.rawValue ?? "noReason", privacy: .public): \(Self.word(ended), privacy: .public)"
    )
    return (ended, record.receipt)
  }

  /// R7: in a request that may use the foreground, puts back what a background step's raise or
  /// activation by the agent changed (the person's front app and window, as `before` recorded them
  /// when the act step began) under the same global-input claim a foreground step takes, waiting
  /// for it no later than the step's `deadline`. It takes nothing back from the person: an app they
  /// switched to stays (``ForegroundScene``). Returns the disturbances with the raise and
  /// activation marked repaired once the person's app and window are back; `found` unchanged when
  /// nothing needs it, the claim was refused or the restore did not hold.
  func repairFront(
    _ found: [ComputerDisturbanceWire], before: DisturbanceSnapshot?, target: Set<pid_t>,
    request: HostRequestWire, deadline: ContinuousClock.Instant, execution: ActionExecution
  ) async -> [ComputerDisturbanceWire] {
    guard ForegroundPolicy.allows(request.envelope), found.frontToRepair, let before else {
      return found
    }
    let owner = ClaimOwner.computer(
      ComputerOperation(runId: execution.runId, operationId: execution.operationId))
    guard
      let claim = try? await arbiter.escalate(
        owner: owner, deadline: min(.now + ForegroundExecutor.claimWait, deadline))
    else { return found }
    defer { claim.release() }
    let diagnostics = ForegroundRestorationDiagnostics(
      operation: ComputerOperation(runId: execution.runId, operationId: execution.operationId),
      before: before, target: target)
    let restored = await ForegroundScene(before).restore(
      target: target, shown: nil, diagnostics: diagnostics)
    diagnostics.finished(restored)
    Self.log.notice(
      "Background restoration attempt: front=\(restored.front.rawValue, privacy: .public)")
    return restored.putBack ? found.repairing() : found
  }

  private static func word(_ end: ActionExecution.StepEnd) -> String {
    switch end {
    case .finished(.success): "done"
    case .finished(.failure(let failure)): failure.code.rawValue
    case .unconverged: "unconverged"
    }
  }
}
