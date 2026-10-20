import AICore
import Foundation

/// What the coordinator does with the disturbance guard's findings (plan §4.3, I6): a step that
/// reached the target and disturbed the person, by the guard's attribution, ends its action
/// `disturbed` (its effect follows what was actually dispatched), and the engine stops using that
/// step's route for that kind of step in that app for the rest of its generation. Disturbances
/// attributed to the person or to nobody in particular are only recorded on the result. Repairs
/// happen inside the engine's primitive (its receipt says so); the host never activates or raises
/// anything to undo a change.
extension ComputerCoordinator {
  /// The engine's receipt of a step that ended with one.
  static func receipt(of end: ActionExecution.StepEnd) -> EngineInputReceipt? {
    if case .finished(.success(let outcome)) = end { return outcome.receipt }
    return nil
  }

  /// Ends the action after a step that completed, and demotes the step's `route` when the engine
  /// reported one.
  func endDisturbed(
    _ found: [ComputerDisturbanceWire], step: ComputerStepWire, route: ActionResultWire.Route?,
    engine: any ComputerEngine, ref: TargetRefWire, fold: inout ActionResultFold
  ) {
    fold.stop(Self.disturbed(found, demoted: route != nil).wire)
    guard let route else { return }
    engine.demote(route, for: step.kind, on: ref)
    Self.log.notice(
      "Demoted route \(route.rawValue, privacy: .public) for \(step.kind.rawValue, privacy: .public) steps after a disturbance."
    )
  }

  /// The failure that ends an action whose step disturbed the person, after the step's own
  /// `failure` when the step failed too; `demoted` when the step's route was demoted.
  static func disturbed(
    _ found: [ComputerDisturbanceWire], after failure: ComputerFailure? = nil,
    demoted: Bool = false
  ) -> ComputerFailure {
    var kinds: [String] = []
    for disturbance in found where disturbance.attribution == .agent {
      if !kinds.contains(disturbance.kind.rawValue) { kinds.append(disturbance.kind.rawValue) }
    }
    var message =
      "The step disturbed the person (\(kinds.joined(separator: ", "))); the action stopped."
    if demoted { message += " This app no longer gets that route for this kind of step." }
    if let failure { message += " The step also failed: \(failure.message)" }
    return ComputerFailure(
      .disturbed, message, mayHaveDispatched: failure?.mayHaveDispatched ?? false)
  }
}
