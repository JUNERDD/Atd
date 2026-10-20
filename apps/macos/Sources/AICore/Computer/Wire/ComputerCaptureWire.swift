import CoreGraphics
import Foundation

/// `ComputerRectSchema`.
public struct ComputerRectWire: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double
  public let width: Double
  public let height: Double

  public init(_ rect: CGRect) {
    x = rect.origin.x
    y = rect.origin.y
    width = max(0, rect.width)
    height = max(0, rect.height)
  }

  public var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    x = try container.number(.x)
    y = try container.number(.y)
    width = try container.number(.width, minimum: 0)
    height = try container.number(.height, minimum: 0)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case x, y, width, height }
}

/// The image types a capture is encoded as.
public enum ComputerImageMime: String, Codable, CaseIterable, Sendable {
  case png = "image/png"
  case jpeg = "image/jpeg"
}

/// `ComputerCaptureSchema`: the geometry of one window capture, so a pixel of it maps back to the
/// screen. `width` and `height` are the image's pixels; `scale` is pixels per point; `frame` is
/// the window in screen points (Quartz, top-left origin) when it was captured; `crop`, when set,
/// is the captured part in points relative to `frame`'s origin.
public struct ComputerCaptureWire: Codable, Equatable, Sendable {
  public let id: String
  public let surfaceRefId: String?
  public let mime: ComputerImageMime
  public let width: Int
  public let height: Int
  public let scale: Double
  public let frame: ComputerRectWire
  public let crop: ComputerRectWire?
  public let capturedAt: String
  /// Conservative host use-by deadline, not the driver's exact capture expiry.
  public let expiresAt: String?

  public init(
    id: String, surfaceRefId: String? = nil, mime: ComputerImageMime, width: Int, height: Int,
    scale: Double, frame: ComputerRectWire, crop: ComputerRectWire? = nil, capturedAt: Date,
    expiresAt: Date? = nil
  ) {
    self.id = id
    self.surfaceRefId = surfaceRefId
    self.mime = mime
    self.width = max(1, width)
    self.height = max(1, height)
    self.scale = scale
    self.frame = frame
    self.crop = crop
    self.capturedAt = ComputerWireCoding.timestamp(capturedAt)
    self.expiresAt = expiresAt.map(ComputerWireCoding.timestamp)
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.refId(.id)
    surfaceRefId = try container.optional(.surfaceRefId) { try container.refId($0) }
    mime = try container.value(.mime, ComputerImageMime.self)
    width = try container.integer(.width, minimum: 1)
    height = try container.integer(.height, minimum: 1)
    scale = try container.number(.scale)
    guard scale > 0, scale.isFinite else {
      throw DecodingError.dataCorruptedError(
        forKey: .scale, in: container, debugDescription: "scale must be above 0.")
    }
    frame = try container.value(.frame, ComputerRectWire.self)
    crop = try container.optional(.crop) { try container.value($0, ComputerRectWire.self) }
    capturedAt = try container.string(.capturedAt)
    expiresAt = try container.optional(.expiresAt) { try container.string($0) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id, surfaceRefId, mime, width, height, scale, frame, crop, capturedAt, expiresAt
  }
}

/// `ComputerTextBoxSchema`: text recognized in a capture, with its box in that capture's pixels.
public struct ComputerTextBoxWire: Codable, Equatable, Sendable {
  public let text: String
  public let rect: ComputerRectWire
  public let confidence: Double?

  public init(text: String, rect: ComputerRectWire, confidence: Double? = nil) {
    self.text = text.wireClipped(500)
    self.rect = rect
    self.confidence = confidence.map { min(max($0, 0), 1) }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    text = try container.string(.text, minLength: 1, maxLength: 500)
    rect = try container.value(.rect, ComputerRectWire.self)
    confidence = try container.optional(.confidence) {
      try container.number($0, minimum: 0, maximum: 1)
    }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case text, rect, confidence }
}

/// `ComputerObservationProblemSchema`: why an observation is less than it was asked for.
public enum ComputerObservationProblem: String, Codable, CaseIterable, Sendable {
  case treeEmpty
  case treeTruncated
  case screenshotUnavailable
  case screenshotFrameInvalid
  case textUnavailable
  /// The tree and the capture do not describe the same state of the surface.
  case treeImageConflict
}
