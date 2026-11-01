import AICore
import AppKit

/// The window/input collector. All persistence and report lifecycle belong to SupportDiagnostics.
final class FocusDiagnostics {
  static let shared = FocusDiagnostics()
  static var enabled: Bool { SupportDiagnostics.profile == .focus }
  private var monitoring: FocusDiagnosticMonitoring?
  private var permissions: FocusDiagnosticPermissions?
  private var lastBurst = 0.0
  var tapActive: Bool { monitoring?.tapActive == true }
  var coverage: [String: JSONValue] { monitoring?.coverage ?? [:] }

  func start() {
    guard Self.enabled, monitoring == nil else { return }
    monitoring = FocusDiagnosticMonitoring()
    monitoring?.start()
  }

  @discardableResult
  func record(
    _ name: String, details: [String: JSONValue] = [:], system: Bool = false,
    correlation: Int? = nil
  ) -> Int {
    guard Self.enabled else { return 0 }
    return SupportDiagnostics.shared.record(
      name, module: "focus", details: details,
      snapshot: { FocusDiagnosticSnapshot.read(system: system) }, correlation: correlation)
  }

  func tick() {
    guard Self.enabled else { return }
    monitoring?.refreshPermission()
    permissions?.refresh(mouseTapActive: tapActive)
    record("focus.sample", system: true)
  }

  func mouse(_ event: NSEvent, stage: String) {
    guard Self.enabled else { return }
    let correlation = record(
      stage,
      details: [
        "type": .number(Double(event.type.rawValue)), "timestamp": .number(event.timestamp),
        "eventNumber": .number(Double(event.eventNumber)),
        "windowNumber": .number(Double(event.windowNumber)),
        "button": .number(Double(event.buttonNumber)),
        "clickCount": .number(Double(event.clickCount)),
        "locationInWindow": .array([
          .number(event.locationInWindow.x), .number(event.locationInWindow.y),
        ]),
      ])
    if event.type == .leftMouseDown || event.type == .rightMouseDown
      || event.type == .otherMouseDown
    {
      burst(correlation: correlation)
    }
  }

  enum MiniStage: String {
    case original
    case replayed
    case routed
    case dragBegan
    case dragCancelled
    case releaseScroller
    case releaseDrag
    case releaseCancelled
    case clickConsumed
    case replayQueued
    case cancelled
    case heldEnded
    case menuBegan
    case menuEnded
  }

  /// Receipt and routing only: existing mouse monitors own snapshots and follow-up bursts.
  /// Routing stages retain the original down event's identity, even when the press ends later.
  func mini(_ stage: MiniStage, _ event: NSEvent?, _ target: MiniPanelPress? = nil) {
    guard Self.enabled, let event else { return }
    if stage == .original {
      switch event.type {
      case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
        .otherMouseDown, .otherMouseUp:
        break
      default: return
      }
    }
    var details: [String: JSONValue] = [
      "type": .number(Double(event.type.rawValue)), "timestamp": .number(event.timestamp),
      "eventNumber": .number(Double(event.eventNumber)),
      "windowNumber": .number(Double(event.windowNumber)),
      "button": .number(Double(event.buttonNumber)),
      "modifiers": .number(Double(event.modifierFlags.rawValue)),
    ]
    if let target {
      let surface =
        switch target {
        case .none: "none"
        case .body: "body"
        case .card: "card"
        case .activityEntry: "activityEntry"
        case .scroller: "scroller"
        case .dropShape: "dropShape"
        }
      details["surface"] = .string(surface)
      let control =
        switch target.control {
        case .none: "none"
        case .some(.mark): "mark"
        case .some(.newTask): "newTask"
        case .some(.ask): "ask"
        case .some(.screenshot): "screenshot"
        case .some(.commands): "commands"
        case .some(.row): "commandRow"
        }
      details["control"] = .string(control)
      if case .some(.row(let index)) = target.control { details["row"] = .number(Double(index)) }
    }
    SupportDiagnostics.shared.record("mini.\(stage.rawValue)", module: "focus", details: details)
  }

  /// All activation follow-ups run; general mouse bursts are throttled to keep tracing bounded.
  func burst(correlation: Int, activation: Bool = false) {
    guard Self.enabled else { return }
    let now = ProcessInfo.processInfo.systemUptime
    guard activation || now - lastBurst > 0.2 else { return }
    lastBurst = now
    for delay in [0.0, 0.05, 0.25, 1.0] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.record(
          activation ? "activation.followup" : "mouse.followup",
          details: ["delay": .number(delay)], system: true, correlation: correlation)
      }
    }
  }

  func preparePermissions(using trust: AccessibilityTrust, automatic: Bool = false) {
    guard Self.enabled else { return }
    if permissions == nil { permissions = FocusDiagnosticPermissions(trust: trust) }
    permissions?.request(automatic: automatic, mouseTapActive: monitoring?.tapActive == true)
  }

  func tapDisabled(reason: String) {
    monitoring?.tapDisabled(reason: reason)
  }

  static let reportNotes = """
    Focus collector: compare mouse.tap, mouse.local/global, native.mouse.before/after and
    renderer.pointerdown/click. native.activation.request/return and activation.followup occur
    only for explicit fallback calls when the panel's nativeClickActivation is false. A true policy
    value means the guarded setter was invoked, not that WindowServer honored it. Infer native
    click activation from timed mouse.followup snapshots; a missing request is not no activation.
    Read frontmost, axFocus, keyWindow and WindowServer independently.
    mini.original/replayed distinguish non-replayed and internally replayed mouse events; they
    do not prove hardware origin. Routing stages retain the original down event's windowNumber,
    eventNumber and timestamp; record uptime/wallTime marks when each routing stage occurred.
    mini.clickConsumed means the owner's onClick returned true; mini.replayQueued/replayed prove
    queueing/dispatch only, not a SwiftUI action or selection capture. Mini records add no snapshots
    or bursts; correlate existing mouse.followup/focus.sample evidence for system focus changes.
    Cocoa coordinates are bottom-left; WindowServer/CGEvent coordinates are top-left.
    Receiver and windowAtPointer fields are hints; native receipt proves delivery.
    Missing AX or event-tap coverage is not proof that no click occurred. Complete requested
    Accessibility/Input Monitoring permission before reproduction. Screen Recording is not needed.
    """
}
