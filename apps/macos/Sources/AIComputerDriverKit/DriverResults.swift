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

/// `prepare`/`release` result: what the driver actually armed or restored, so the host tracks the
/// prepared state without assuming success.
public struct DriverPrepareResult: Codable, Equatable, Sendable {
  public var webAccessibilityEnabled: Bool
  public var occlusionKeepAlivePinned: Bool

  public init(webAccessibilityEnabled: Bool, occlusionKeepAlivePinned: Bool) {
    self.webAccessibilityEnabled = webAccessibilityEnabled
    self.occlusionKeepAlivePinned = occlusionKeepAlivePinned
  }
}

/// A bare acknowledgement for requests whose success is their only payload (`release`, `cancel`).
public struct DriverAck: Codable, Equatable, Sendable {
  public var ok: Bool

  public init(ok: Bool = true) {
    self.ok = ok
  }
}
