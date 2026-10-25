import CoreGraphics
import Foundation

/// The host's own record of one window capture it returned (plan §4.4): which surface and window
/// it shows, the window's frame when it was taken, the part of the window it holds and how its
/// pixels map back to the source image and to the screen. The model only ever sees the wire form;
/// image points it names are mapped through this record, never trusted as screen points.
///
/// Coordinates: `frame` is the window in Quartz global points (y down); `crop`, when set, is the
/// captured part in points relative to `frame`'s origin; the image has `width` × `height` pixels
/// at `scale` pixels per point. The source image (`sourceWidth` × `sourceHeight`: the
/// ScreenCaptureKit shot, or the driver's off-Space capture) is the whole window; a cropped
/// capture was cut from it at the same scale.
public struct NativeCapture: Equatable, Sendable {
  public let id: String
  /// The surface it shows; nil for the target's root surface.
  public let surfaceRefId: String?
  public let pid: Int
  public let windowId: Int
  public let width: Int
  public let height: Int
  public let scale: Double
  public let frame: CGRect
  public let crop: CGRect?
  public let mime: ComputerImageMime
  public let sourceWidth: Int
  public let sourceHeight: Int
  public let capturedAt: Date
  /// How long image points of the capture are honored: 60 seconds from just before the read, so
  /// transport and postprocessing never extend it. Pixels older than that may no longer show the
  /// window as it is, so input aimed through them is refused and the model observes again.
  public struct UseBy: Equatable, Sendable {
    public let date: Date
    public let instant: ContinuousClock.Instant

    public init(before date: Date, clock: ContinuousClock.Instant) {
      self.date = date.addingTimeInterval(60)
      instant = clock + .seconds(60)
    }
  }
  public let useBy: UseBy?
  public var isExpired: Bool { useBy.map { ContinuousClock.now >= $0.instant } ?? false }

  /// Tolerance for comparing recorded and live window geometry, in points.
  public static let tolerance: CGFloat = 1
  /// How far the image's two axes may disagree on the scale before the capture is refused.
  static let aspectTolerance = 0.03

  public init(
    id: String, surfaceRefId: String?, pid: Int, windowId: Int, frame: CGRect, crop: CGRect?,
    mime: ComputerImageMime, sourceWidth: Int, sourceHeight: Int, capturedAt: Date,
    useBy: UseBy? = nil
  ) {
    let scale = Self.scale(frame: frame, width: sourceWidth, height: sourceHeight) ?? 1
    let pixels = crop.map {
      Self.pixels(of: $0, scale: scale, within: CGSize(width: sourceWidth, height: sourceHeight))
    }
    self.id = id
    self.surfaceRefId = surfaceRefId
    self.pid = pid
    self.windowId = windowId
    self.scale = scale
    self.frame = frame
    self.crop = crop
    self.mime = mime
    self.sourceWidth = sourceWidth
    self.sourceHeight = sourceHeight
    self.capturedAt = capturedAt
    self.useBy = useBy
    width = max(1, Int(pixels?.width ?? CGFloat(sourceWidth)))
    height = max(1, Int(pixels?.height ?? CGFloat(sourceHeight)))
  }

  /// Pixels per point of an image of `width` × `height` showing a window of `frame`; nil when
  /// the sizes are empty or the two axes disagree (the image is not this window).
  public static func scale(frame: CGRect, width: Int, height: Int) -> Double? {
    guard frame.width > 0, frame.height > 0, width > 0, height > 0 else { return nil }
    let horizontal = Double(width) / frame.width
    let vertical = Double(height) / frame.height
    guard abs(horizontal - vertical) / max(horizontal, vertical) <= aspectTolerance else {
      return nil
    }
    return horizontal
  }

  /// The source-image pixel rect of `crop` (points relative to the window), rounded outwards to
  /// whole pixels and kept inside an image of `size`.
  public static func pixels(of crop: CGRect, scale: Double, within size: CGSize) -> CGRect {
    let rect = CGRect(
      x: crop.minX * scale, y: crop.minY * scale, width: crop.width * scale,
      height: crop.height * scale
    ).integral.intersection(CGRect(origin: .zero, size: size))
    return rect.isNull ? .zero : rect
  }

  /// The pixel rect of the crop in the source image; the whole image without a crop.
  public var sourcePixels: CGRect {
    let size = CGSize(width: sourceWidth, height: sourceHeight)
    return crop.map { Self.pixels(of: $0, scale: scale, within: size) }
      ?? CGRect(origin: .zero, size: size)
  }

  public func contains(x: Int, y: Int) -> Bool {
    x >= 0 && y >= 0 && x < width && y < height
  }

  /// The pixel of the source image an image point of this capture names.
  public func sourcePoint(x: Int, y: Int) -> CGPoint {
    CGPoint(x: sourcePixels.minX + CGFloat(x), y: sourcePixels.minY + CGFloat(y))
  }

  /// The screen point an image point names, for a window whose origin is now `origin`.
  public func screenPoint(x: Int, y: Int, windowOrigin origin: CGPoint) -> CGPoint {
    let pixel = sourcePoint(x: x, y: y)
    return CGPoint(x: origin.x + pixel.x / scale, y: origin.y + pixel.y / scale)
  }

  /// `rect` (Quartz global points) in pixels of this capture, clipped to it; nil when it lies
  /// outside the capture.
  public func pixelRect(of rect: CGRect) -> CGRect? {
    let local = CGRect(
      x: (rect.minX - frame.minX) * scale - sourcePixels.minX,
      y: (rect.minY - frame.minY) * scale - sourcePixels.minY, width: rect.width * scale,
      height: rect.height * scale)
    let clipped = local.intersection(CGRect(x: 0, y: 0, width: width, height: height))
    return clipped.isNull || clipped.isEmpty ? nil : clipped
  }

  /// `rect`, in pixels of this capture, as points relative to the window's origin: the window
  /// area a region request asks to capture again. Nil when it covers none of the capture.
  public func windowRect(ofPixels rect: CGRect) -> CGRect? {
    let clipped = rect.intersection(CGRect(x: 0, y: 0, width: width, height: height))
    guard !clipped.isNull, !clipped.isEmpty else { return nil }
    let origin = sourcePixels.origin
    return CGRect(
      x: (origin.x + clipped.minX) / scale, y: (origin.y + clipped.minY) / scale,
      width: clipped.width / scale, height: clipped.height / scale)
  }

  /// Whether the window's logical size still matches. An unused, uncropped root-window capture
  /// keeps its window-relative points through a pure move, which the host maps through the live
  /// origin; a resize or a new pixel density needs a new observation.
  public func matches(size live: CGSize) -> Bool {
    abs(live.width - frame.width) <= Self.tolerance
      && abs(live.height - frame.height) <= Self.tolerance
  }

  /// Whether the window still has the recorded size and position within ``tolerance``.
  public func matches(frame live: CGRect) -> Bool {
    abs(live.minX - frame.minX) <= Self.tolerance && abs(live.minY - frame.minY) <= Self.tolerance
      && matches(size: live.size)
  }

  /// A box normalized to the image (0…1, top-left origin) in pixels of this capture.
  public func pixelRect(normalized box: CGRect) -> CGRect {
    CGRect(
      x: box.minX * Double(width), y: box.minY * Double(height), width: box.width * Double(width),
      height: box.height * Double(height))
  }

  public var wire: ComputerCaptureWire {
    ComputerCaptureWire(
      id: id, surfaceRefId: surfaceRefId, mime: mime, width: width, height: height, scale: scale,
      frame: ComputerRectWire(frame), crop: crop.map(ComputerRectWire.init),
      capturedAt: capturedAt, expiresAt: useBy?.date)
  }
}
