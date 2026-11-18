import AICore
import AppKit

extension SelectionToolbarProbeRunner {
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
}
