import Foundation

/// `ComputerRefusalReasonSchema` (`packages/agent-contracts/src/computer-refusals.ts`): which
/// background limit stopped a request (``ComputerErrorWire/reason``), mostly with
/// ``ComputerErrorCode/noBackgroundRoute``. The host refuses rather than take the foreground, so a
/// person can do that step themselves.
public enum ComputerRefusalReason: String, Codable, CaseIterable, Sendable {
  /// A native drag-and-drop session; only drags inside the target's content have a route.
  case dragAndDrop
  /// Hovering: hover effects and tooltips.
  case hover
  /// An opaque surface (Metal, OpenGL, a game) with no accessibility tree to act on.
  case opaqueSurface
  /// A toolkit that reads the real pointer position (Java, Tk and the like), so input posted to the
  /// window misses.
  case pointerToolkit
  /// Secure text entry is on, which takes no posted input.
  case secureInput
  /// The menu item is missing or cannot be pressed while the app is in the background.
  case menuUnavailable
  /// No route can write the text (no settable value, no key route here).
  case textUnavailable
  /// The key or shortcut has no route (no matching menu item, no key route here).
  case keyUnavailable
  /// The window is minimized; the host never restores it.
  case minimized
  /// The window is on another Space; it can be read but not written.
  case offSpace
  /// The window is in a full-screen Space.
  case fullScreen
  /// Every route for the step was ruled out before anything was sent, for no reason above.
  case noRoute
  /// The managed browser could not be started in the background (the browser is missing, or it
  /// never answered); the person opens it.
  case openBrowser
  /// The Mac is locked or its session is not on the console: macOS hides app windows from
  /// accessibility and drops posted input until the person unlocks it (browser targets keep working).
  case screenLocked
}

/// `ComputerDisturbanceSchema`: one disturbance the host's guard measured around an action, in the
/// eight kinds of the Cua Bench v2 taxonomy. `attribution` says who caused it as far as the host
/// can tell, `repaired` whether the host restored what changed. `detail` is a short note for logs
/// and people, cut to the contract's 200 characters on creation.
public struct ComputerDisturbanceWire: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, CaseIterable, Sendable {
    /// The person's key window lost focus.
    case keyFocus
    /// A window was raised over the person's.
    case raise
    /// The real pointer moved.
    case pointer
    /// The clipboard changed.
    case clipboard
    /// The active Space changed.
    case space
    /// A sheet or dialog appeared on the person's app.
    case dialog
    /// The person's app was activated or deactivated.
    case activation
    /// The person's input was lost or redirected.
    case input
  }

  public enum Attribution: String, Codable, CaseIterable, Sendable {
    /// On the driver's own evidence.
    case agent
    /// On the person's own input.
    case person
    /// Both overlapped, or nothing says.
    case unknown
  }

  public let kind: Kind
  public let attribution: Attribution
  public let repaired: Bool
  public let detail: String?

  public init(kind: Kind, attribution: Attribution, repaired: Bool, detail: String? = nil) {
    self.kind = kind
    self.attribution = attribution
    self.repaired = repaired
    self.detail = detail.map { $0.wireClipped(200) }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    kind = try container.value(.kind, Kind.self)
    attribution = try container.value(.attribution, Attribution.self)
    repaired = try container.boolean(.repaired)
    detail = try container.optional(.detail) { try container.string($0, maxLength: 200) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case kind, attribution, repaired, detail
  }
}
