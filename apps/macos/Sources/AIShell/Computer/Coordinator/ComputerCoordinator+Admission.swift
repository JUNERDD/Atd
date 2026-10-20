import AICore
import Foundation

/// The checks around an action's claim (plan §6.1): before it, whether the request may act on
/// the target at all; once it is held, whether the target, its observation and the person still
/// allow writing.
extension ComputerCoordinator {
  /// Before the claim: the target is current, the engine may serve the request and supports
  /// every step, and writes may start.
  func admit(_ action: ComputerActionWire, request: HostRequestWire)
    throws(ComputerFailure) -> any ComputerEngine
  {
    let kind = try targets.kind(of: action.targetRefId)
    let writes = Self.writes(action)
    let engine = try usableEngine(kind, request: request, screenshot: false)
    let profile = engine.profile
    let conditions =
      action.steps.compactMap { step -> ComputerConditionWire? in
        if case .wait(let condition, _) = step { return condition }
        return nil
      } + [action.postcondition].compactMap { $0 }
    if kind != .native,
      conditions.contains(where: {
        if case .menuItemAvailable = $0 { return true }
        return false
      })
    {
      throw ComputerFailure(
        .unsupported, "Application menus are not browser page state; nothing was sent.")
    }
    if conditions.contains(where: {
      if case .newText(_, _, .some) = $0 { return true }
      return false
    }), kind != .native || request.envelope.unattended {
      throw ComputerFailure(.unsupported, "Regional verification needs an attended native target.")
    }
    for step in action.steps
    where !profile.actions.contains(step.kind) || !profile.effects.contains(step.effect) {
      throw ComputerFailure(
        .unsupported,
        "The \(engine.id.rawValue) engine cannot perform a \(step.kind.rawValue) step.")
    }
    if writes, let block = ComputerScreenState.writeBlock() { throw block }
    return engine
  }

  /// After the claim: still the same target and observation, not cancelled, and nothing keeps
  /// writing from going on (``interruption(_:engine:)``), the person using the target included.
  func revalidate(
    _ action: ComputerActionWire, engine: any ComputerEngine, execution: ActionExecution
  ) async throws(ComputerFailure) -> (TargetRegistry.Entry, ObservationWire) {
    if let stop = execution.stop { throw stop }
    let entry = try targets.current(id: action.targetRefId, engineGeneration: engine.generation)
    if Self.writes(action), let interruption = await interruption(entry.ref, engine: engine) {
      throw interruption
    }
    if let stop = execution.stop { throw stop }
    guard !Task.isCancelled else { throw ComputerFailure(.cancelled, "The action was cancelled.") }
    guard let observation = entry.observation, observation.ref.id == action.observationRefId
    else {
      throw ComputerFailure(
        .staleObservation, "The observation is no longer current; observe the target again.")
    }
    return (entry, observation)
  }
}
