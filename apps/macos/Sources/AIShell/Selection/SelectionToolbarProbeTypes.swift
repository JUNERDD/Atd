import AICore
import AppKit
import ApplicationServices

extension SelectionToolbarProbeRunner {
  struct FrontmostAppInfo {
    let pid: pid_t
    let bundleIdentifier: String?
    let runningApp: NSRunningApplication?
  }

  enum InterruptionCause: UInt8, Sendable {
    case none = 0
    case mouseDown = 1
    case rightMouseDown = 2
    case otherMouseDown = 3
    case keyDown = 4
    case scrollWheel = 5
    case appActivated = 6
    case dismissed = 7

    static func from(eventType: NSEvent.EventType) -> Self {
      switch eventType {
      case .leftMouseDown: .mouseDown
      case .rightMouseDown: .rightMouseDown
      case .otherMouseDown: .otherMouseDown
      case .keyDown: .keyDown
      case .scrollWheel: .scrollWheel
      default: .dismissed
      }
    }

    var gateOutcomeCode: String {
      switch self {
      case .none: "debounce_cancelled"
      case .mouseDown: "debounce_interrupted_mouse_down"
      case .rightMouseDown: "debounce_interrupted_right_click"
      case .otherMouseDown: "debounce_interrupted_other_click"
      case .keyDown: "debounce_interrupted_key"
      case .scrollWheel: "debounce_interrupted_scroll"
      case .appActivated: "debounce_interrupted_app_switch"
      case .dismissed: "debounce_interrupted_dismiss"
      }
    }
  }

  struct LiveStep: Sendable {
    let axTrusted: Bool
    let frontmostBundleId: String?
    let excludedByAppRule: Bool
    let axRole: String?
    let selectedLength: Int
    let gateOutcome: String
  }

  struct GestureInput {
    let pointer: CGPoint
    let pressedAt: CGPoint?
    let clickCount: Int
    let shiftHeld: Bool
    let mayHaveSelected: Bool
    let heldAtPress: Bool
    let heldAtRelease: Bool
    let listeningOn: Bool
    let admitted: Bool
    let settings: SelectionToolbarSettings?
    let trusted: Bool
  }

  static func makeSnapshot(
    settings: SelectionToolbarSettings?, isListening: Bool?, monitorInstalled: Bool
  ) -> DiagnosticsEnvironmentRecord.SelectionToolbarSnapshotRecord {
    DiagnosticsEnvironmentRecord.SelectionToolbarSnapshotRecord(
      settingsReceived: settings != nil,
      enabled: settings?.enabled ?? false,
      activationMode: settings?.activation.mode.rawValue,
      toggleListeningOn: isListening,
      monitorInstalled: monitorInstalled,
      excludedAppCount: settings?.excludedBundleIds.count ?? 0)
  }

  static func encodeActivation(_ mode: SelectionActivation.Mode?) -> UInt8 {
    switch mode {
    case .always: 1
    case .hold: 2
    case .toggle: 3
    case nil: 0
    }
  }

  static func encodeProbeOutcome(_ probe: SelectionProbe) -> UInt8 {
    switch probe {
    case .none: 0
    case .secureField: 1
    case .selected: 2
    case .unmeasured: 3
    case .cells: 4
    }
  }

  static func encodeLengthBucket(_ probe: SelectionProbe) -> UInt8 {
    switch probe {
    case .none, .secureField: 0
    case .selected(let len, _):
      if len <= 0 {
        0
      } else if len <= 32 {
        1
      } else if len <= 256 {
        2
      } else if len <= 4_096 {
        3
      } else {
        4
      }
    case .unmeasured: 5
    case .cells: 6
    }
  }

  static func classifyGateOutcome(
    shows: Bool,
    probe: SelectionProbe,
    lastAxError: Int16,
    permittedByGesture: Bool,
    attemptIndex: Int
  ) -> String {
    if shows { return "panel_shown" }
    if probe == .secureField { return "secure_text_field" }
    if lastAxError == Int16(AXError.apiDisabled.rawValue) { return "ax_api_disabled" }
    if lastAxError == Int16(AXError.cannotComplete.rawValue) { return "ax_timeout" }
    if !permittedByGesture { return "plain_click_no_cells" }
    return attemptIndex == 0 ? "attempt0_empty_debouncing" : "ax_no_selection"
  }

  static func applyAttemptResult(
    to entry: inout SelectionDecisionEntry,
    attemptIndex: Int,
    probe: SelectionProbe,
    trace: SelectionProbeTrace,
    hasBounds: Bool,
    permittedByGesture: Bool,
    shows: Bool
  ) {
    if trace.busyMutexSkipped { entry.flags |= SelectionGateFlags.busyMutexSkipped.rawValue }
    if hasBounds { entry.flags |= SelectionGateFlags.hasBounds.rawValue }
    let outcomeCode = encodeProbeOutcome(probe)
    if attemptIndex == 0 {
      entry.attempt0Outcome = outcomeCode
      entry.attempt0Role = trace.roleCode
      entry.attempt0WebAttrs = trace.webAttrsMask
      entry.attempt0AxError = trace.lastAxError
      entry.attempt0ElapsedUs = trace.elapsedUs
      if !shows { entry.debounceState = 1 }
    } else {
      entry.debounceState = 3
      entry.attempt1Outcome = outcomeCode
      entry.attempt1AxError = trace.lastAxError
      entry.attempt1ElapsedUs = trace.elapsedUs
    }
    entry.selectionLengthBucket = encodeLengthBucket(probe)
    if shows {
      entry.flags |= SelectionGateFlags.shown.rawValue
      entry.dropStage = 0
    } else if attemptIndex == 1 {
      entry.dropStage = !permittedByGesture ? 8 : 9
    }
  }
}
