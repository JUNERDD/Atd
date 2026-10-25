import Foundation

/// The UI toolkit a target window is built with, as the driver's probe classifies it from the
/// frameworks the app ships and the shape of its AX subtree. The host uses it to choose and gate
/// routes (for example, refuse `pointer` on `opaque`, take the Chromium click recipe on `chromium`).
public enum DriverToolkit: String, Codable, Equatable, Sendable, CaseIterable {
  case appKit
  case swiftUI
  case catalyst
  case chromium
  case electron
  case cef
  case webKit
  case qt
  case java
  case flutter
  /// A Metal/GL/no-AX-subtree surface: background input is a hard wall (`opaqueSurface`).
  case opaque
  /// Could not be classified; treat conservatively (AX only).
  case unknown
}

/// One optional capability of the driver, reported in `hello`. A capability is present only when
/// its private symbols resolve AND the first-use behavioral self-test passes; a later failure
/// latches it off for the life of the process (plan §2.2/D6). The host never branches on OS
/// version — it reads these facts.
public struct DriverCapability: Codable, Equatable, Sendable {
  public var name: String
  public var available: Bool
  /// Why it is unavailable (missing symbols, failed self-test), for logs.
  public var detail: String?

  public init(name: String, available: Bool, detail: String? = nil) {
    self.name = name
    self.available = available
    self.detail = detail
  }
}

/// Well-known capability names the host looks for in the `hello` report. Strings, not an enum, so
/// the driver can report capabilities a given host build does not yet know about.
public enum DriverCapabilityName {
  /// Semantic AX reads and actions (always expected; the floor of the ladder).
  public static let accessibility = "accessibility"
  /// Window-routed synthetic events (`SLEventPostToPid` + stamping): the pointer/keys/scroll rungs.
  public static let windowEvents = "windowEvents"
  /// Target-only key scope (focus records, no raise): required before window-routed keys.
  public static let keyScope = "keyScope"
  /// Occlusion keep-alive (`SLSPackagesEnableWindowOcclusionNotifications`).
  public static let occlusionKeepAlive = "occlusionKeepAlive"
  /// Off-Space window capture (`SLSHWCaptureWindowList`).
  public static let offSpaceCapture = "offSpaceCapture"
  /// Space/front-process queries used for route gating and disturbance checks.
  public static let windowServerQueries = "windowServerQueries"
}

/// The driver's response to `hello`: the protocol version it speaks, the signed app bundle id it
/// is attributed to (for the host to confirm TCC inheritance), and the capability report.
public struct DriverHello: Codable, Equatable, Sendable {
  public var protocolVersion: Int
  /// The driver generation, stamped into every synthetic event's source user data so a passive
  /// monitor can attribute agent input. Rises when the driver restarts (plan I8).
  public var generation: Int
  /// The bundle id macOS attributes this process to, when resolvable.
  public var attributedBundleId: String?
  public var capabilities: [DriverCapability]

  public init(
    protocolVersion: Int, generation: Int, attributedBundleId: String? = nil,
    capabilities: [DriverCapability]
  ) {
    self.protocolVersion = protocolVersion
    self.generation = generation
    self.attributedBundleId = attributedBundleId
    self.capabilities = capabilities
  }
}

/// Where a target window sits relative to the user, decided before a write so the host can refuse
/// `minimized`/`offSpace`/`fullScreen` without the driver ever changing visibility.
public struct DriverWindowPlacement: Codable, Equatable, Sendable {
  public var minimized: Bool
  /// The window is on a Space one of the displays is showing: with separate Spaces per display,
  /// the active Space of whichever display holds it, not only the focused display's. True when
  /// the driver cannot tell (``spaceKnown``), so a background read is not refused on a guess.
  public var onActiveSpace: Bool
  public var fullScreen: Bool
  /// Whether the window server told the window's Spaces and the ones on screen; absent or false
  /// when it did not, and ``onActiveSpace`` is then an assumption.
  public var spaceKnown: Bool?

  public init(minimized: Bool, onActiveSpace: Bool, fullScreen: Bool, spaceKnown: Bool? = nil) {
    self.minimized = minimized
    self.onActiveSpace = onActiveSpace
    self.fullScreen = fullScreen
    self.spaceKnown = spaceKnown
  }
}

/// The result of a `probe`: the toolkit classification, the target window's placement, and the
/// routes the driver believes are usable for it right now. `routes` lists at most the six event
/// rungs plus the AX rungs; the host still climbs the ladder and verifies.
public struct DriverProbeResult: Codable, Equatable, Sendable {
  public var toolkit: DriverToolkit
  public var placement: DriverWindowPlacement
  /// Whether the app exposes a web-accessibility tree (after enablement) for web content.
  public var webAccessibility: Bool
  /// The routes the probe judges available, most-imperceptible first (bounded to 6).
  public var routes: [DriverRoute]

  public init(
    toolkit: DriverToolkit, placement: DriverWindowPlacement, webAccessibility: Bool = false,
    routes: [DriverRoute] = []
  ) {
    self.toolkit = toolkit
    self.placement = placement
    self.webAccessibility = webAccessibility
    self.routes = Array(routes.prefix(6))
  }
}
