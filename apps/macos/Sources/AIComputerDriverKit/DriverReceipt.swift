import Foundation

/// Which rung of the route ladder actually delivered a primitive. The host records degradations
/// keyed partly by this, and the monitor shows what the agent did.
public enum DriverRoute: String, Codable, Equatable, Sendable {
  /// A semantic AX action (`AXPress`/`AXPick`/set `AXValue`/menu-item press/`AXScroll*`).
  case axAction
  /// AX text write via `AXValue` or `AXSelectedText`.
  case axText
  /// AX menu-bar path resolve-and-press (no menu opened).
  case axMenu
  /// AX scroll (`AXScrollToVisible` / `AXScroll*ByPage`).
  case axScroll
  /// A window-routed pointer event posted to the target pid.
  case pointer
  /// A window-routed scroll-wheel event posted to the target pid.
  case scroll
  /// Window-routed key events posted to the target pid inside a key scope.
  case keys
  /// Window-routed Unicode text posted to the target pid inside a key scope.
  case text
  /// A window-routed in-content drag stream.
  case drag
}

/// What the driver did to the target-only key scope for a primitive that needed one. The host's
/// disturbance guard trusts this over its own global monitor for key-focus facts (plan I8).
public struct DriverKeyScopeReport: Codable, Equatable, Sendable {
  /// Whether a key scope was opened at all (AX routes do not need one, nor a target window that
  /// is already the frontmost app's key window).
  public var used: Bool
  /// Whether the driver confirmed the target window became the app's key window before acting
  /// (via the app's `AXFocusedWindow`). False means the scope could not be proven and the
  /// primitive was refused rather than risking keys landing in a sibling window.
  public var confirmed: Bool
  /// Whether key was handed back: true when the reverse records addressed the user's previous key
  /// window, and also true when the user had no key window (nothing to hand back is not a failed
  /// return). False means a previous key window existed but could not be addressed — a
  /// disturbance the host attributes to the agent.
  public var returned: Bool
  /// Whether the user's previous key window was re-read as key again after the scope closed.
  /// Nil when the user had no key window, so there was nothing to restore; omitted on the wire.
  public var userWindowRestored: Bool?

  public init(
    used: Bool, confirmed: Bool = false, returned: Bool = false, userWindowRestored: Bool? = nil
  ) {
    self.used = used
    self.confirmed = confirmed
    self.returned = returned
    self.userWindowRestored = userWindowRestored
  }
}

/// The checks the driver made around a write, so the host attributes disturbances without doing
/// cross-process AX on its own main actor. All are the driver's own observations.
public struct DriverFrontmostCheck: Codable, Equatable, Sendable {
  /// The WindowServer-frontmost pid before the primitive, as the driver saw it.
  public var frontmostPidBefore: Int?
  /// The WindowServer-frontmost pid after the primitive. A change the driver did not intend is a
  /// disturbance.
  public var frontmostPidAfter: Int?
  /// Whether the target became the frontmost app during the primitive; a target that was
  /// frontmost before it was not raised by it.
  public var targetRaised: Bool

  public init(
    frontmostPidBefore: Int? = nil, frontmostPidAfter: Int? = nil, targetRaised: Bool = false
  ) {
    self.frontmostPidBefore = frontmostPidBefore
    self.frontmostPidAfter = frontmostPidAfter
    self.targetRaised = targetRaised
  }
}

/// The driver's account of how one `perform` was delivered. Returned on success; the agent-side
/// truth is this receipt, not the host's passive monitor (plan I8).
public struct DriverReceipt: Codable, Equatable, Sendable {
  /// The rung that delivered the primitive.
  public var route: DriverRoute
  /// Whether the driver actually dispatched the input/action (false only for a no-op success,
  /// e.g. an element already in the requested state).
  public var dispatched: Bool
  /// The key-scope account, present when the route needed one.
  public var keyScope: DriverKeyScopeReport?
  /// The frontmost/z-order observations around the primitive.
  public var frontmost: DriverFrontmostCheck?
  /// Wall-clock milliseconds the driver spent handling the primitive, for host-side budgeting.
  public var elapsedMilliseconds: Double?

  public init(
    route: DriverRoute, dispatched: Bool, keyScope: DriverKeyScopeReport? = nil,
    frontmost: DriverFrontmostCheck? = nil, elapsedMilliseconds: Double? = nil
  ) {
    self.route = route
    self.dispatched = dispatched
    self.keyScope = keyScope
    self.frontmost = frontmost
    self.elapsedMilliseconds = elapsedMilliseconds
  }
}
