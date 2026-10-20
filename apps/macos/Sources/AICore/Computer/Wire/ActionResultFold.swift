import Foundation

/// Folds what happened to an action's steps into its ``ActionResultWire`` (D4), so every engine
/// and every stop path reports dispatch, effect and retry by the same rules:
///
/// - `dispatch`: `not_dispatched` when no step reached the target; `dispatched` when the step that
///   stopped the action may have reached it (its outcome is not known); `settled` otherwise.
/// - `effect`: `none` when no write step (any effect but `read`) reached the target; `unknown`
///   when a write step may have reached it without the host knowing; `partial` when the action
///   stopped after some writes, or its postcondition did not hold; `verified` when every step ran
///   and the postcondition held, or, without one, when the engine verified every write step;
///   otherwise `unknown`.
/// - `retry`: `safe` only when no write reached the target; `never` once a business effect
///   (`invoke`, `submit`) did or may have; `after_review` otherwise.
///
/// `evidence` is what the steps reported, led by one `text` entry naming the postcondition when
/// it was checked after the steps and did not hold: nothing else in the result says so in words,
/// and leading the list keeps the entry whenever the list is cut to its limit.
public struct ActionResultFold: Sendable {
  /// How a step that ran to its end went, as the engine reported it.
  public enum StepOutcome: Equatable, Sendable {
    /// The engine found nothing to do (the value already matched, the page did not need it).
    case notDispatched
    /// The input reached the target; the engine could not confirm the intended state.
    case dispatched
    /// The input reached the target and the engine confirmed the intended state.
    case verified
  }

  public enum Postcondition: Equatable, Sendable {
    case absent
    case held
    /// The condition, checked after the steps, did not hold.
    case notHeld(ComputerConditionWire)
    /// The check itself failed; whether the action worked is unknown.
    case failed(ComputerErrorWire)
  }

  public let actionId: String
  public let steps: [ComputerStepWire]
  public private(set) var outcomes: [StepOutcome] = []
  /// What stopped the action at step `outcomes.count`, and whether that step may have reached the
  /// target before it stopped.
  public private(set) var stop: (error: ComputerErrorWire, mayHaveDispatched: Bool)?
  public var postcondition: Postcondition = .absent
  public private(set) var evidence: [ComputerEvidenceWire] = []
  public var invalidated: String?
  /// How the engine delivered the input and through which route, reported as is.
  public var delivery: ComputerDelivery?
  public var route: ActionResultWire.Route?
  /// What the guard saw change for the person, the first ``ComputerWireLimits/maxDisturbances``
  /// kept. Recording one does not stop the action; the caller stops it `disturbed` when the guard
  /// attributes one to the agent.
  public private(set) var disturbances: [ComputerDisturbanceWire] = []
  /// The files the steps downloaded, the first ``ComputerWireLimits/maxDownloads`` kept.
  public private(set) var downloads: [ComputerDownloadWire] = []

  public init(actionId: String, steps: [ComputerStepWire]) {
    self.actionId = actionId
    self.steps = steps
  }

  /// The index of the next step to run; `steps.count` once all ran.
  public var nextStep: Int { outcomes.count }
  public var isStopped: Bool { stop != nil }
  public var isFinished: Bool { stop != nil || outcomes.count == steps.count }

  /// Whether anything reached, or may have reached, the target.
  public var anyDispatched: Bool {
    outcomes.contains { $0 != .notDispatched } || stop?.mayHaveDispatched == true
  }

  public mutating func complete(_ outcome: StepOutcome, evidence more: [ComputerEvidenceWire] = [])
  {
    guard !isFinished else { return }
    outcomes.append(outcome)
    evidence.append(contentsOf: more)
  }

  /// Records files a step downloaded, also after the action stopped: they exist either way.
  public mutating func downloaded(_ files: [ComputerDownloadWire]) {
    let room = ComputerWireLimits.maxDownloads - downloads.count
    if room > 0 { downloads.append(contentsOf: files.prefix(room)) }
  }

  /// Records disturbances the guard measured, also after the action stopped: they happened either
  /// way.
  public mutating func disturbed(_ found: [ComputerDisturbanceWire]) {
    let room = ComputerWireLimits.maxDisturbances - disturbances.count
    if room > 0 { disturbances.append(contentsOf: found.prefix(room)) }
  }

  /// Stops the action before or during step ``nextStep``. Only the first stop counts.
  public mutating func stop(_ error: ComputerErrorWire, mayHaveDispatched: Bool = false) {
    guard stop == nil else { return }
    let running = outcomes.count < steps.count
    stop = (error, mayHaveDispatched && running)
  }

  public func result() -> ActionResultWire {
    let writes = outcomes.indices.filter {
      steps[$0].effect != .read && outcomes[$0] != .notDispatched
    }
    let uncertain =
      stop.map { $0.mayHaveDispatched && steps[outcomes.count].effect != .read }
      ?? false
    let dispatch: ActionResultWire.Dispatch =
      !anyDispatched ? .notDispatched : stop?.mayHaveDispatched == true ? .dispatched : .settled
    let effect: ActionResultWire.Effect
    if writes.isEmpty, !uncertain {
      // Nothing changed; a read-only action whose postcondition held still proves that condition,
      // which is how an earlier unknown outcome gets checked (the service's `resolves`).
      effect = stop == nil && postcondition == .held ? .verified : .none
    } else if uncertain {
      effect = .unknown
    } else if stop != nil {
      effect = .partial
    } else {
      switch postcondition {
      case .held: effect = .verified
      case .notHeld: effect = .partial
      case .failed: effect = .unknown
      case .absent: effect = writes.allSatisfy { outcomes[$0] == .verified } ? .verified : .unknown
      }
    }
    let touchedBusiness =
      writes.contains { steps[$0].effect.isBusiness }
      || (uncertain && steps[outcomes.count].effect.isBusiness)
    let retry: ActionResultWire.Retry =
      writes.isEmpty && !uncertain ? .safe : touchedBusiness ? .never : .afterReview
    var error = stop?.error
    if error == nil, case .failed(let failure) = postcondition { error = failure }
    var reported = evidence
    if case .notHeld(let condition) = postcondition {
      reported.insert(Self.unmet(condition), at: 0)
    }
    return ActionResultWire(
      actionId: actionId, dispatch: dispatch, effect: effect, completedSteps: outcomes.count,
      stoppedAt: stop != nil && outcomes.count < steps.count ? outcomes.count : nil, error: error,
      evidence: reported, retry: retry, invalidated: invalidated, delivery: delivery, route: route,
      disturbances: disturbances, downloads: downloads)
  }

  /// The entry saying `condition` did not hold after the steps: its kind and what it names (its
  /// text or value, menu path or pattern), clipped so the summary fits the 500 characters
  /// evidence holds.
  private static func unmet(_ condition: ComputerConditionWire) -> ComputerEvidenceWire {
    let (kind, detail): (String, String?) =
      switch condition {
      case .textAppears(let text): ("textAppears", text)
      case .valueEquals(_, let text): ("valueEquals", text)
      case .menuItemAvailable(let path): ("menuItemAvailable", path.joined(separator: " > "))
      case .urlMatches(let pattern): ("urlMatches", pattern)
      case .newText(_, let pattern, _): ("newText", pattern)
      case .enabled: ("enabled", nil)
      }
    var summary = "Postcondition not met after the steps: \(kind)"
    if let detail {
      // 400 leaves the rest of the summary room within its 500.
      let shown = detail.unicodeScalars.count > 400 ? detail.wireClipped(399) + "…" : detail
      summary += " “\(shown)”"
    }
    return ComputerEvidenceWire(kind: .text, summary: summary + ".")
  }

  /// The result of an action refused before any step ran, with the background limit behind the
  /// refusal when one applies.
  public static func refused(
    actionId: String, steps: [ComputerStepWire], _ code: ComputerErrorCode, _ message: String,
    reason: ComputerRefusalReason? = nil
  ) -> ActionResultWire {
    var fold = ActionResultFold(actionId: actionId, steps: steps)
    fold.stop(ComputerErrorWire(code: code, message: message, reason: reason))
    return fold.result()
  }
}
