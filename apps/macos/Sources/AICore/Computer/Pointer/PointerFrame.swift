import Foundation

/// One mark of the live operation pointer (plan §3.4): a task's current operation on one target.
/// Each target shows only its task's current operation, so a key holds at most one mark; two
/// tasks working one target have two keys and so two marks, told apart by their badges.
public struct PointerKey: Hashable, Sendable {
  public let taskId: String
  /// The target reference the operation acts on, as the host's target registry names it.
  public let targetRefId: String

  public init(taskId: String, targetRefId: String) {
    self.taskId = taskId
    self.targetRefId = targetRefId
  }
}

/// The host step an operation is in, as its own progress reports it (locating, dispatch,
/// verification and the end); never derived from the model's explanation of the step.
public enum PointerPhase: String, Sendable, CaseIterable {
  /// The host is resolving the target; the mark highlights where it was found.
  case locating
  /// An input was sent to the target; its cue identifies the input, without claiming success.
  case dispatching
  /// Text is being typed, filled or cleared. Only the field is marked: semantic fills give no
  /// trustworthy character positions, so no per-character caret is drawn.
  case typingField = "typing-field"
  /// The host waits for the target to settle.
  case waiting
  /// The host checks the outcome.
  case verifying
  /// The step ended; verified results show completion, others finish their neutral input cue.
  case done
  /// The step failed; its mark goes at once.
  case failed
}

/// What the overlay draws for one key, built by the coordinator from the host's progress after
/// its visibility checks. A frame without a trusted on-screen rect clears the mark rather than
/// leaving an old one over a page that has changed.
public struct PointerFrame: Equatable, Sendable {
  /// The badge's length limit, so concurrent tasks stay told apart without a label per task.
  public static let badgeLimit = 3

  public let key: PointerKey
  /// A short name for the task (at most ``badgeLimit`` characters), shown while marks of more
  /// than one task are on screen.
  public let taskBadge: String
  public let phase: PointerPhase
  public let action: PointerAction
  /// The target's frame in Quartz global screen points (origin at the primary display's
  /// top-left, y down); nil when the host has no trusted, visible position for it.
  public let targetRect: CGRect?
  /// Whether verification confirmed the step; only a verified ``PointerPhase/done`` shows its
  /// completion.
  public let verified: Bool
  /// When the observation behind the rect stops being trusted; the mark goes then unless a newer
  /// frame replaced it.
  public let validUntil: Date
  /// Increases with every frame of the key; an older or repeated frame is dropped.
  public let sequence: Int

  public init(
    key: PointerKey, taskBadge: String, phase: PointerPhase, targetRect: CGRect?,
    verified: Bool = false, validUntil: Date, sequence: Int, action: PointerAction = .other
  ) {
    self.key = key
    self.taskBadge = String(
      taskBadge.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.badgeLimit))
    self.phase = phase
    self.action = action
    self.targetRect = targetRect
    self.verified = verified
    self.validUntil = validUntil
    self.sequence = sequence
  }
}

/// What the overlay does with a frame for its key.
public enum PointerDecision: Equatable, Sendable {
  /// Not newer than the last frame of the key: dropped, and the mark stays as it is.
  case stale
  /// Draw or move the key's mark as the frame says, and remove it at `until`.
  case show(until: Date)
  /// Draw the brief completion of a verified step, and remove it at `until`.
  case complete(until: Date)
  /// Finish the feedback of an input already shown, without claiming its result succeeded.
  case settle(until: Date)
  /// Remove the key's mark now.
  case clear
}

/// Decides show, move and clear for the live pointer; the overlay only draws what this says.
public enum PointerFramePolicy {
  /// Minimum time to perceive a dispatched input, measured from dispatch rather than its end.
  /// A newer action, invalid position, failure or explicit clear always takes precedence.
  public static let feedbackHold: TimeInterval = 0.5
  /// How long a verified completion stays.
  public static let completionHold: TimeInterval = 0.8
  /// Moves longer than this (points) jump instead of gliding: a glide is only a hint of where the
  /// mark went, and a long one would read as the real pointer travelling.
  public static let glideLimit: CGFloat = 480

  /// The decision for `frame`, given the sequence of the last frame accepted for its key (nil
  /// for none) and the time now. Only a newer sequence counts; an expired frame, one without a
  /// drawable rect and a failed step clear. An unverified end only finishes an existing input
  /// cue; it never creates a mark or extends that cue's original deadline.
  public static func decide(
    _ frame: PointerFrame, after lastSequence: Int?, now: Date, feedbackUntil: Date? = nil
  )
    -> PointerDecision
  {
    if let lastSequence, frame.sequence <= lastSequence { return .stale }
    guard frame.validUntil > now, let rect = frame.targetRect, isDrawable(rect) else {
      return .clear
    }
    switch frame.phase {
    case .failed:
      return .clear
    case .done:
      guard frame.verified else {
        guard let feedbackUntil, feedbackUntil > now else { return .clear }
        return .settle(until: min(frame.validUntil, feedbackUntil))
      }
      return .complete(until: min(frame.validUntil, now.addingTimeInterval(completionHold)))
    case .locating, .dispatching, .typingField, .waiting, .verifying:
      return .show(until: frame.validUntil)
    }
  }

  /// Whether a rect can be drawn: finite, with an area.
  public static func isDrawable(_ rect: CGRect) -> Bool {
    guard !rect.isNull, !rect.isInfinite else { return false }
    let edges = [rect.minX, rect.minY, rect.width, rect.height]
    return edges.allSatisfy(\.isFinite) && rect.width > 0 && rect.height > 0
  }

  /// Whether task badges show: only while marks of more than one task are on screen.
  public static func showsBadges(_ keys: some Sequence<PointerKey>) -> Bool {
    Set(keys.map(\.taskId)).count > 1
  }

  /// Whether a mark on the same display glides from `previous` to `next` rather than jumping:
  /// never under Reduce Motion, never for a first appearance, never for a long move.
  public static func glides(from previous: CGRect?, to next: CGRect, reduceMotion: Bool) -> Bool {
    guard !reduceMotion, let previous, previous != next else { return false }
    let dx = next.midX - previous.midX
    let dy = next.midY - previous.midY
    return (dx * dx + dy * dy).squareRoot() <= glideLimit
  }
}
