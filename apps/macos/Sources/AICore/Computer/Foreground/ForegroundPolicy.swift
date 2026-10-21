import AIComputerDriverKit
import Foundation

/// When the host does a step in the foreground (docs/plans/2026-10-21-foreground-fallback.md,
/// R1–R4, R8, R13). It is a fallback inside the same `act`, never a request: once every background
/// route of a step was ruled out and nothing was sent, for a reason the foreground gets past, an
/// attended request the service allows (``ExecutionEnvelopeWire/foregroundAllowed``) has the step
/// done in the foreground instead. The target app comes to the front, and the step's input goes to
/// it as the background sends it, as events posted to its process: never through the HID system,
/// never moving the person's pointer. What stays with the person: secure input, the lock screen, a
/// minimized window, a window on another Space, in full screen or on a Space the host cannot tell,
/// a target in use, a missing permission, a step aimed at a capture point, a right click, an app
/// that follows only the real pointer, and keys or text for an app that takes no posted keys.
public enum ForegroundPolicy {
  /// The step kinds with a foreground route: a left click, a key, typed text and a drag inside the
  /// step's window, each between points or into a focus the host finds without a capture point.
  public static let kinds: Set<ComputerStepKind> = [.click, .key, .type, .drag]

  /// The background limits the foreground gets past: no route left (one the guard switched off
  /// after a disturbance included), keys, text or a menu shortcut the background cannot send, and
  /// a drag, whose in-content route runs only in the foreground. Toolkits that follow the real
  /// pointer or draw without accessibility are not among them: posted input misses there in front
  /// of the person as well.
  public static let lifted: Set<ComputerRefusalReason> = [
    .noRoute, .keyUnavailable, .textUnavailable, .menuUnavailable, .dragAndDrop,
  ]

  /// How long the person must have left the keyboard, the buttons, the pointer, scrolling and
  /// gestures alone before the target is brought forward (R4.1): long enough that a pause between
  /// words or clicks does not count.
  public static let quiet: Duration = .seconds(1)
  /// The longest a step waits for that pause before it refuses `inputInUse`, never past its
  /// deadline.
  public static let longestWait: Duration = .seconds(5)

  /// Whether `envelope`'s request may use the foreground at all: the service allowed it, and the
  /// run is attended and acts without a recipe's grant (the service already sends `false` for
  /// grant runs; the host does not rely on that alone).
  public static func allows(_ envelope: ExecutionEnvelopeWire) -> Bool {
    envelope.foregroundAllowed && !envelope.unattended && envelope.grantRef == nil
  }

  /// Whether `step`, refused with `code` and `reason` (and `mayHaveDispatched`, which must be
  /// false: a step that may have acted is never sent again), is done in the foreground instead. A
  /// right click is not: the context menu it opens closes again once the person's app is back in
  /// front.
  public static func takes(
    _ step: ComputerStepWire, refused code: ComputerErrorCode, reason: ComputerRefusalReason?,
    mayHaveDispatched: Bool
  ) -> Bool {
    guard code == .noBackgroundRoute, !mayHaveDispatched, let reason, lifted.contains(reason),
      kinds.contains(step.kind), !step.isVisual
    else { return false }
    if case .click(_, let button, _) = step { return button != .right }
    return true
  }

  /// Whether the foreground's input for a `kind` step reaches a window of `toolkit`. It goes out
  /// as the background's window-routed events do, so it reaches the toolkits that take those as
  /// aimed: clicks and drags native and Chromium windows, keys and text native windows only
  /// (Chromium takes no posted keys, in front or not).
  public static func reaches(_ kind: ComputerStepKind, on toolkit: DriverToolkit) -> Bool {
    let events = NativeRoutePolicy.withEvents
    switch kind {
    case .click: return events.allows(.pointer, on: toolkit)
    case .drag: return events.allows(.drag, on: toolkit)
    case .key: return events.allows(.keys, on: toolkit)
    case .type: return events.allows(.text, on: toolkit) && events.allows(.keys, on: toolkit)
    default: return false
    }
  }

  /// How long until the person will have left every input alone for ``quiet`` since their latest
  /// (`lastActivity`); nil once they have, or when none is known.
  public static func quietWait(
    lastActivity: ContinuousClock.Instant?, now: ContinuousClock.Instant
  ) -> Duration? {
    guard let lastActivity else { return nil }
    let quietAt = lastActivity + quiet
    return now < quietAt ? quietAt - now : nil
  }

  /// The deliveries a target lists for a `kind` step (R8): `background` when one of its background
  /// routes is open, and `foreground` when the request allows the foreground, Atd may post input
  /// events, and the kind's foreground input reaches the window's `toolkit`.
  public static func delivery(
    _ kind: ComputerStepKind, background: Bool, foreground: Bool, postsEvents: Bool,
    toolkit: DriverToolkit
  ) -> [ComputerDelivery] {
    var delivery: [ComputerDelivery] = background ? [.background] : []
    if foreground, postsEvents, kinds.contains(kind), reaches(kind, on: toolkit) {
      delivery.append(.foreground)
    }
    return delivery
  }
}
