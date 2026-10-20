import Foundation

/// `hello`: the handshake. The client states the protocol version it speaks; the driver answers
/// with `DriverHello` (its version, generation and capability report).
public struct DriverHelloRequest: Codable, Equatable, Sendable {
  public var clientProtocolVersion: Int

  public init(clientProtocolVersion: Int = driverProtocolVersion) {
    self.clientProtocolVersion = clientProtocolVersion
  }
}

/// `probe`: classify a target window's toolkit and placement and report usable routes.
public struct DriverProbeRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget

  public init(target: DriverTarget) {
    self.target = target
  }
}

/// `prepare`: arm background-observation aids for a target. `enableWebAccessibility` sets
/// `AXManualAccessibility` (Chromium/Electron/CEF) and, when the app took it, waits for the tree;
/// `occlusionKeepAlive` pins the window's visible state while it is still unoccluded. Both are
/// idempotent. The pin is undone by `release`, driver exit, or `atexit`; web accessibility stays
/// on.
public struct DriverPrepareRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget
  public var enableWebAccessibility: Bool
  public var occlusionKeepAlive: Bool

  public init(target: DriverTarget, enableWebAccessibility: Bool, occlusionKeepAlive: Bool) {
    self.target = target
    self.enableWebAccessibility = enableWebAccessibility
    self.occlusionKeepAlive = occlusionKeepAlive
  }
}

/// `release`: undo what `prepare` armed for a target (restores occlusion notifications). Web
/// accessibility is left enabled: turning it off has observable side effects and is not safe to
/// toggle per action.
public struct DriverReleaseRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget

  public init(target: DriverTarget) {
    self.target = target
  }
}

/// `snapshot`: read the element tree of a target window. The driver bounds the result to
/// `maxElements` (default 600) and `maxDepth`, filters layout-only containers, and returns a new
/// snapshot generation that invalidates the previous element tokens for this window.
public struct DriverSnapshotRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget
  public var maxElements: Int?
  public var maxDepth: Int?

  public init(target: DriverTarget, maxElements: Int? = nil, maxDepth: Int? = nil) {
    self.target = target
    self.maxElements = maxElements
    self.maxDepth = maxDepth
  }
}

/// `perform`: deliver one primitive. `routeAllow` is the set of rungs the host permits (the
/// driver never climbs past them). `deadlineMilliseconds` bounds the whole attempt; on timeout
/// the driver returns `cancelled` with `mayHaveDispatched` set for a stuck UI-opening action.
/// `userTypedWithinGuard` is the host's fact that the user typed inside the key-return guard
/// window (≈300 ms): when true the driver refuses to open a key scope (`userTyping`).
public struct DriverPerformRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget
  public var primitive: DriverPrimitive
  public var routeAllow: [DriverRoute]
  public var deadlineMilliseconds: Double
  public var userTypedWithinGuard: Bool

  public init(
    target: DriverTarget, primitive: DriverPrimitive, routeAllow: [DriverRoute],
    deadlineMilliseconds: Double, userTypedWithinGuard: Bool = false
  ) {
    self.target = target
    self.primitive = primitive
    self.routeAllow = routeAllow
    self.deadlineMilliseconds = deadlineMilliseconds
    self.userTypedWithinGuard = userTypedWithinGuard
  }
}

/// `capture`: a bounded JPEG of a target window's current content via off-Space hardware capture,
/// for windows on another Space where ScreenCaptureKit returns nothing. A fully transparent
/// result is treated as failure (`capability_unavailable`).
public struct DriverCaptureRequest: Codable, Equatable, Sendable {
  public var target: DriverTarget
  public var maxLongEdge: Int?

  public init(target: DriverTarget, maxLongEdge: Int? = nil) {
    self.target = target
    self.maxLongEdge = maxLongEdge
  }
}

/// `cancel`: ask the driver to abandon an in-flight request by its frame id. A stuck AX action is
/// left to finish on its detached worker; the pid stays busy until it returns.
public struct DriverCancelRequest: Codable, Equatable, Sendable {
  public var cancelId: Int

  public init(cancelId: Int) {
    self.cancelId = cancelId
  }
}
