import AICore
import Foundation

/// What the coordinator does with the disturbance guard's findings (plan §4.3, I6): a step that
/// reached the target and disturbed the person, by the guard's attribution, ends its action
/// `disturbed` (its effect follows what was actually dispatched), and the engine stops using that
/// step's route for that kind of step in that app until the person replies, or until Atd quits
/// once the route disturbed them twice (``RouteDemotion``). Disturbances attributed to the person
/// or to nobody in particular are only recorded on the result. Repairs happen inside the engine's
/// primitive (its receipt says so), with two exceptions for requests that may use the foreground:
/// a foreground step puts back what it changed itself and never switches a route off (R6), and
/// the host puts back a background step's raise or activation (R7), after which the action goes on
/// while that step's route still goes off
/// (``repairFront(_:before:target:request:deadline:execution:)``).
extension ComputerCoordinator {
  /// The engine's receipt of a step that ended with one.
  static func receipt(of end: ActionExecution.StepEnd) -> EngineInputReceipt? {
    if case .finished(.success(let outcome)) = end { return outcome.receipt }
    return nil
  }

  /// Ends the action after a step of `run` that completed, and demotes the step's `route` when
  /// the engine reported one and the step stayed in the background. In a request that may use the
  /// foreground, a background step whose only agent disturbances were put back (R7) does not end
  /// the action.
  func endDisturbed(
    _ found: [ComputerDisturbanceWire], step: ComputerStepWire, route: ActionResultWire.Route?,
    foreground: Bool, request: HostRequestWire, engine: any ComputerEngine, ref: TargetRefWire,
    run: String, fold: inout ActionResultFold
  ) {
    let demoted = foreground ? nil : route
    let demotion = demoted.flatMap { engine.demote($0, for: step.kind, on: ref, run: run) }
    if Self.putBack(found, foreground: foreground, request: request) {
      Self.log.notice(
        "Put back a background disturbance; the action goes on with its route switched off.")
      return
    }
    fold.stop(Self.disturbed(found, demotion: demotion).wire)
    guard let route = demoted, demotion != nil else { return }
    Self.log.notice(
      "Demoted route \(route.rawValue, privacy: .public) for \(step.kind.rawValue, privacy: .public) steps after a disturbance."
    )
  }

  /// Whether the agent's disturbances by a background step in a request that may use the
  /// foreground were all a raise or an activation the host put back (R7), which then ends no
  /// action.
  static func putBack(
    _ found: [ComputerDisturbanceWire], foreground: Bool, request: HostRequestWire
  ) -> Bool {
    !foreground && ForegroundPolicy.allows(request.envelope) && found.onlyRepairedFront
  }

  /// The failure that ends an action whose step disturbed the person, after the step's own
  /// `failure` when the step failed too, with how long the step's route stays off when the engine
  /// demoted it.
  static func disturbed(
    _ found: [ComputerDisturbanceWire], after failure: ComputerFailure? = nil,
    demotion: RouteDemotion? = nil
  ) -> ComputerFailure {
    var kinds: [String] = []
    for disturbance in found where disturbance.attribution == .agent {
      if !kinds.contains(disturbance.kind.rawValue) { kinds.append(disturbance.kind.rawValue) }
    }
    var message =
      "The step disturbed the person (\(kinds.joined(separator: ", "))); the action stopped."
    switch demotion {
    case .run?:
      message +=
        " That route stays off for this kind of step in this app until the person replies, and"
        + " until Atd restarts if it disturbs them again."
    case .everyRun?:
      message +=
        " That route has now disturbed the person twice and stays off for this kind of step in"
        + " this app until Atd restarts."
    case nil: break
    }
    if let failure { message += " The step also failed: \(failure.message)" }
    return ComputerFailure(
      .disturbed, message, mayHaveDispatched: failure?.mayHaveDispatched ?? false)
  }
}
