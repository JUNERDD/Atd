import AICore
import Foundation

/// One line in the computer log for each act and each observe the host ran, written as it
/// answers: which request it was, how it ended and where its time went (``OperationPhases``).
/// Ids, kinds, counts and outcome words only, never text from the screen, so the line is public.
extension ComputerCoordinator {
  func logTiming(of action: ComputerActionWire, reply: HostReplyWire, phases: OperationPhases) {
    let steps = action.steps.map(\.kind.rawValue).joined(separator: "+")
    let ending = Self.ending(reply)
    Self.log.notice(
      "Act \(action.actionId, privacy: .public) on \(action.targetRefId, privacy: .public) [\(steps, privacy: .public)] \(ending, privacy: .public) \(phases.summary, privacy: .public)"
    )
  }

  func logTiming(
    of request: HostRequestWire, target: String, reply: HostReplyWire, phases: OperationPhases
  ) {
    let ending = Self.ending(reply)
    Self.log.notice(
      "Observe \(request.requestId, privacy: .public) on \(target, privacy: .public) \(ending, privacy: .public) \(phases.summary, privacy: .public)"
    )
  }

  /// `effect=verified route=events`, `effect=none error=inputInUse`, `error=staleObservation`,
  /// or for an observation `elements=1 texts=72 problems=treeImageConflict`.
  private static func ending(_ reply: HostReplyWire) -> String {
    switch reply.outcome {
    case .failed(let error):
      return "error=\(error.code.rawValue)"
    case .ok(.actionResult(let result)):
      let route = result.route.map { " route=\($0.rawValue)" } ?? ""
      let error = result.error.map { " error=\($0.code.rawValue)" } ?? ""
      return "effect=\(result.effect.rawValue)\(route)\(error)"
    case .ok(.observation(let observation)):
      let problems = (observation.problems ?? []).map(\.rawValue).joined(separator: ",")
      return "elements=\(observation.elements.count) texts=\(observation.text?.count ?? 0)"
        + (problems.isEmpty ? "" : " problems=\(problems)")
    case .ok:
      return "ok"
    }
  }
}
