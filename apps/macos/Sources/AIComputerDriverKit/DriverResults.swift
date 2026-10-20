import Foundation

/// `snapshot` result: a flat element array plus the generation that addresses their tokens.
public struct DriverSnapshotResult: Codable, Equatable, Sendable {
  /// The snapshot id; element tokens are `<snapshotId>.e<index>`. A later snapshot of the same
  /// window supersedes it and invalidates these tokens.
  public var snapshotId: String
  public var target: DriverTarget
  /// The window title the driver read, when present. The host decides whether to surface it.
  public var windowTitle: String?
  public var elements: [DriverElement]
  /// True when the tree was clamped by the element or depth bound.
  public var truncated: Bool
  /// Why the read was degraded (`axTreeEmpty`, `axWindowUnresolved`, ...), for the host to project.
  public var degradedReason: String?

  public init(
    snapshotId: String, target: DriverTarget, windowTitle: String? = nil,
    elements: [DriverElement], truncated: Bool = false, degradedReason: String? = nil
  ) {
    self.snapshotId = snapshotId
    self.target = target
    self.windowTitle = windowTitle
    self.elements = elements
    self.truncated = truncated
    self.degradedReason = degradedReason
  }
}

/// `perform` result: the receipt plus any disturbances the driver itself detected around the
/// write (the host's guard adds its own non-AX signals).
public struct DriverPerformResult: Codable, Equatable, Sendable {
  public var receipt: DriverReceipt

  public init(receipt: DriverReceipt) {
    self.receipt = receipt
  }
}

/// `capture` result: a JPEG of the window and its pixel size, with the scale factor so the host
/// maps window points to capture pixels the same way it does for the SCK path.
public struct DriverCaptureResult: Codable, Equatable, Sendable {
  public var jpegBase64: String
  public var pixelWidth: Int
  public var pixelHeight: Int
  /// Pixels per window point in this JPEG: `pixelWidth` divided by the window's width in points.
  /// It equals the display backing scale when no downscale was needed and is smaller after the
  /// image was fitted to `maxLongEdge`. Multiply a window-local point by it to get a JPEG pixel.
  public var scaleFactor: Double

  public init(jpegBase64: String, pixelWidth: Int, pixelHeight: Int, scaleFactor: Double) {
    self.jpegBase64 = jpegBase64
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
    self.scaleFactor = scaleFactor
  }
}

/// `prepare` result: what the driver actually armed, so the host tracks the prepared state without
/// assuming success. Each outcome is nil when the request did not ask for it.
public struct DriverPrepareResult: Codable, Equatable, Sendable {
  public var webAccessibility: DriverWebAccessibilityOutcome?
  public var occlusionKeepAlive: DriverKeepAliveOutcome?

  public init(
    webAccessibility: DriverWebAccessibilityOutcome?, occlusionKeepAlive: DriverKeepAliveOutcome?
  ) {
    self.webAccessibility = webAccessibility
    self.occlusionKeepAlive = occlusionKeepAlive
  }
}

/// What turning on an app's web accessibility did.
public enum DriverWebAccessibilityOutcome: String, Codable, Equatable, Sendable {
  /// The window shows a web area, at once or within the wait.
  case webArea
  /// The app took the attribute, but no web area showed within the wait: it may build one later,
  /// or never (an embedded browser that exposes only its window).
  case noWebArea
  /// The app took neither attribute, so nothing was waited for; it may not have answered yet.
  case refused
}

/// What pinning a window's visible state did.
public enum DriverKeepAliveOutcome: String, Codable, Equatable, Sendable {
  /// The window is pinned, now or from an earlier request.
  case pinned
  /// Every point of the window's grid is under another window, so nothing was tried: the switch
  /// cannot un-hide a window its app already treats as hidden.
  case covered
  /// The window server refused the switch; the driver latched occlusion keep-alive off for the
  /// rest of its process.
  case failed
  /// Occlusion keep-alive is off in this driver process (latched off earlier, or never present),
  /// so nothing was tried.
  case unavailable
}

/// A bare acknowledgement for requests whose success is their only payload (`release`, `cancel`).
public struct DriverAck: Codable, Equatable, Sendable {
  public var ok: Bool

  public init(ok: Bool = true) {
    self.ok = ok
  }
}
