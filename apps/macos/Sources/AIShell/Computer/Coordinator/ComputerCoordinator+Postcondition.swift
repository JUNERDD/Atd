import AICore
import Foundation

enum PostconditionPreparation {
  case held
  case check
  case stopped(ComputerFailure)
}

extension ComputerCoordinator {
  /// Reuses only the final successful wait's absolute check, before any further suspension.
  /// Relative text baselines can differ between an engine's wait and standalone check.
  func preparePostcondition(
    _ action: ComputerActionWire, condition: ComputerConditionWire, ref: TargetRefWire,
    engine: any ComputerEngine, execution: ActionExecution, deadline: ContinuousClock.Instant,
    completedSteps: Int, lastStepInvalidated: Bool
  ) -> PostconditionPreparation {
    if let stop = execution.stop { return .stopped(stop) }
    guard !Task.isCancelled else {
      return .stopped(ComputerFailure(.cancelled, "The action was cancelled."))
    }
    guard ContinuousClock.now < deadline else {
      return .stopped(ComputerFailure(.timeout, "The request's deadline passed."))
    }
    guard action.targetRefId == ref.id, completedSteps == action.steps.count, !lastStepInvalidated,
      let last = action.steps.last, case .wait(let waited, _) = last, waited == condition
    else { return .check }
    if case .newText = condition { return .check }
    // A navigation may invalidate the registered observation while the action retains its
    // original baseline. Only target identity and generation must still match here.
    guard (try? targets.current(ref, engineGeneration: engine.generation)) != nil else {
      return .check
    }
    return .held
  }
}
