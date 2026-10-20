import AIComputerDriverKit
import Foundation

/// Which window-routed event rungs the native engine may climb to, per toolkit (plan §4.2). The
/// accessibility rungs need no entry: they run wherever the element exposes the action or the
/// settable attribute. This is the only place the event enablement lives; the probe verdicts
/// (S2 for a background-window click, S3 for the key scope handed back, S5 for the event marker
/// and modifiers) flip it here, never at a call site.
public struct NativeRoutePolicy: Equatable, Sendable {
  /// The event rungs and the toolkits each one may run on.
  public var events: [DriverRoute: Set<DriverToolkit>]

  public init(events: [DriverRoute: Set<DriverToolkit>]) {
    self.events = events
  }

  /// The window-routed event rungs; every other route is an accessibility rung.
  public static let eventRoutes: Set<DriverRoute> = [.pointer, .scroll, .keys, .text, .drag]

  /// The toolkits whose windows deliver posted events as the driver aims them. Java, Qt and
  /// Flutter read the real pointer or track only in the key window, an opaque surface drops
  /// posted input, and an unclassified window stays on accessibility.
  private static let native: Set<DriverToolkit> = [.appKit, .swiftUI, .catalyst, .webKit]
  /// Chromium, Electron and CEF: posted keyboard input needs an authentication envelope this
  /// round does not open, so keys and text stay off.
  private static let chromium: Set<DriverToolkit> = [.chromium, .electron, .cef]

  /// The event rungs per toolkit for when an unlocked, on-console run of S2, S3 and S5 passes.
  public static let withEvents = NativeRoutePolicy(events: [
    .pointer: native.union(chromium), .scroll: native.union(chromium),
    .drag: native.union(chromium), .keys: native, .text: native,
  ])

  /// What ships (root decision D-LADDER-2): the unlocked re-run passed S2 (a background-window
  /// click with the key scope handed back) and S3/S5's mechanism (restoration read after the
  /// hand-back, no modifier leak), so pointer, scroll, keys and text run per toolkit. In-content
  /// drag stays off until a probe covers it; ``withEvents`` is the full set.
  public static let standard = NativeRoutePolicy(events: [
    .pointer: native.union(chromium), .scroll: native.union(chromium), .keys: native,
    .text: native,
  ])

  /// Whether `route` may run on a window of `toolkit`.
  public func allows(_ route: DriverRoute, on toolkit: DriverToolkit) -> Bool {
    guard Self.eventRoutes.contains(route) else { return true }
    return events[route]?.contains(toolkit) == true
  }

  /// Whether `route` opens a target-only key scope: keys and text do, and so does a pointer click
  /// on every toolkit, since AppKit discards a mouse-down to a window that is not key and Chromium
  /// takes a first mouse only in the active window.
  public static func opensKeyScope(_ route: DriverRoute) -> Bool {
    switch route {
    case .keys, .text, .pointer: true
    default: false
    }
  }

  /// Why a toolkit offers no pointer input at all, for the refusal; nil when the toolkit is not
  /// what rules the pointer out.
  public static func pointerRefusal(on toolkit: DriverToolkit) -> ComputerRefusalReason? {
    switch toolkit {
    case .java, .qt: .pointerToolkit
    case .opaque, .flutter: .opaqueSurface
    default: nil
    }
  }
}

/// Where the target window sits for its ladder (root decision D-LADDER-3, probe S10): the
/// accessibility rungs act on a window on another Space or in a full-screen Space without the
/// person's Space, front app, key window or window order changing, so they run wherever the
/// window is; window-routed events run on the active Space only. A minimized window takes no
/// write at all and never reaches a ladder.
public enum NativeWindowPlacement: Equatable, Sendable {
  case activeSpace
  /// On a Space the person is not on, a full-screen one included.
  case otherSpace
  /// In its own full-screen Space, which the person is on.
  case fullScreen

  public init(onActiveSpace: Bool, fullScreen: Bool) {
    self = !onActiveSpace ? .otherSpace : fullScreen ? .fullScreen : .activeSpace
  }

  /// The reason an event rung ruled out here names; nil on the active Space.
  public var eventRefusal: ComputerRefusalReason? {
    switch self {
    case .activeSpace: nil
    case .otherSpace: .offSpace
    case .fullScreen: .fullScreen
    }
  }

  /// Limits of the target or the step that no Space changes, which a refusal names over the
  /// placement.
  static let walls: Set<ComputerRefusalReason> = [
    .secureInput, .pointerToolkit, .opaqueSurface, .hover,
  ]
}

/// What a step's ladder is built under, as the engine read it right before the write.
public struct NativeRouteFacts: Equatable, Sendable {
  public var toolkit: DriverToolkit
  /// The driver capabilities that are available (``DriverCapabilityName``).
  public var capabilities: Set<String>
  /// Whether Atd may post input events (the PostEvent grant).
  public var postsEvents: Bool
  /// The routes the disturbance guard demoted for this app and step kind.
  public var demoted: Set<DriverRoute>
  public var policy: NativeRoutePolicy
  public var placement: NativeWindowPlacement

  public init(
    toolkit: DriverToolkit, capabilities: Set<String>, postsEvents: Bool,
    demoted: Set<DriverRoute> = [], policy: NativeRoutePolicy = .standard,
    placement: NativeWindowPlacement = .activeSpace
  ) {
    self.toolkit = toolkit
    self.capabilities = capabilities
    self.postsEvents = postsEvents
    self.demoted = demoted
    self.policy = policy
    self.placement = placement
  }

  /// Why `route` is ruled out before anything is sent; nil when it may be tried.
  public func exclusion(of route: DriverRoute) -> NativeRouteExclusion? {
    if demoted.contains(route) { return .demoted }
    guard NativeRoutePolicy.eventRoutes.contains(route) else {
      return capabilities.contains(DriverCapabilityName.accessibility) ? nil : .capability
    }
    guard placement == .activeSpace else { return .placement }
    guard policy.allows(route, on: toolkit) else {
      return policy.events[route]?.isEmpty == false ? .toolkit : .disabled
    }
    guard postsEvents else { return .permission }
    guard capabilities.contains(DriverCapabilityName.windowEvents) else { return .capability }
    if opensKeyScope(route), !capabilities.contains(DriverCapabilityName.keyScope) {
      return .capability
    }
    return nil
  }

  /// Whether `route` opens a target-only key scope on this window.
  public func opensKeyScope(_ route: DriverRoute) -> Bool {
    NativeRoutePolicy.opensKeyScope(route)
  }
}

/// Why a rung was left out of a ladder before anything was sent.
public enum NativeRouteExclusion: String, Equatable, Sendable {
  /// The window is not on the active Space, where only the accessibility rungs run
  /// (``NativeWindowPlacement``).
  case placement
  /// The event route is off for every toolkit in the policy (in ``NativeRoutePolicy/standard``,
  /// in-content drag).
  case disabled
  /// The route runs on other toolkits, not this one (``NativeRoutePolicy``).
  case toolkit
  /// The driver lacks the capability (private symbols, key scope, accessibility trust).
  case capability
  /// Atd may not post input events (the PostEvent grant is missing).
  case permission
  /// The route disturbed the person on this app earlier in the engine's generation.
  case demoted
}

extension DriverPrimitive {
  /// The route the driver delivers this primitive on (driver protocol v1).
  public var route: DriverRoute {
    switch self {
    case .axAction, .axFocus: .axAction
    case .axSetValue, .axInsertText: .axText
    case .axMenu: .axMenu
    case .axScroll: .axScroll
    case .pointer: .pointer
    case .scroll: .scroll
    case .keys: .keys
    case .text: .text
    case .drag: .drag
    }
  }

  /// Whether the primitive only moves the app's focus and has no effect of its own.
  public var isPreparation: Bool {
    if case .axFocus = self { true } else { false }
  }
}

extension DriverRoute {
  /// Every route, for mapping a result route back to its rungs.
  public static let all: [DriverRoute] = [
    .axAction, .axText, .axMenu, .axScroll, .pointer, .scroll, .keys, .text, .drag,
  ]

  /// The result route a rung reports: accessibility, menu or events.
  public var wire: ActionResultWire.Route {
    switch self {
    case .axAction, .axText, .axScroll: .accessibility
    case .axMenu: .menu
    case .pointer, .scroll, .keys, .text, .drag: .events
    }
  }
}

extension DriverElement {
  /// Whether the element advertises `action` (unprefixed, as the driver reports actions).
  func offers(_ action: String) -> Bool { actions.contains(action) }

  /// Whether the driver read `attribute` (`AXValue`, `AXFocused`, `AXSelectedText`) as settable.
  func settable(_ attribute: String) -> Bool { settableAttributes.contains(attribute) }
}
