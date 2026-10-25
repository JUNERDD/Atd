import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Captures one window that sits on another Space, where ScreenCaptureKit returns nothing, via
/// the private `SLSHWCaptureWindowList` backing-store read (plan §4.1; A3 conclusion 3). The
/// image is downscaled to a bounded long edge and JPEG-encoded. A fully transparent result means
/// WindowServer had nothing to give and is treated as failure. Read-only: it never switches
/// Spaces, raises, or activates. Adapted from open-computer-use / Cua capture paths (MIT).
enum OffSpaceCapture {
  static let defaultMaxLongEdge = 1280

  struct Capture {
    let jpegBase64: String
    let pixelWidth: Int
    let pixelHeight: Int
    /// Pixels per window point in the returned JPEG: `pixelWidth / windowPointWidth`. Equals the
    /// display backing scale when no downscale was needed, and less after fitting `maxLongEdge`.
    let scaleFactor: Double
  }

  /// Capture `windowId` at a bounded long edge, or nil when the SPI is unavailable or the image
  /// came back empty/transparent. `windowPointWidth` is the window's width in points (from
  /// `CGWindowList`), which turns the returned pixel size into a points-to-pixels scale.
  static func capture(windowId: CGWindowID, maxLongEdge: Int?, windowPointWidth: Double)
    -> Capture?
  {
    guard let image = WindowServerQueries.hardwareCaptureImage(windowId: windowId) else {
      return nil
    }
    guard hasOpaqueContent(image) else { return nil }
    let limit = maxLongEdge ?? defaultMaxLongEdge
    let scaled = downscale(image, maxLongEdge: limit) ?? image
    guard let data = encodeJPEG(scaled) else { return nil }
    return Capture(
      jpegBase64: data.base64EncodedString(), pixelWidth: scaled.width, pixelHeight: scaled.height,
      scaleFactor: Double(scaled.width) / windowPointWidth)
  }

  /// Draw the alpha channel into an 8×8 grayscale context and keep the result only if any sample
  /// is non-transparent. A fully transparent capture means the backing store was empty.
  private static func hasOpaqueContent(_ image: CGImage) -> Bool {
    let side = 8
    var pixels = [UInt8](repeating: 0, count: side * side)
    guard
      let context = CGContext(
        data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)
    else { return true }  // cannot sample: do not drop a possibly-valid image
    context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
    return pixels.contains { $0 != 0 }
  }

  private static func downscale(_ image: CGImage, maxLongEdge: Int) -> CGImage? {
    let longEdge = max(image.width, image.height)
    guard longEdge > maxLongEdge else { return image }
    let scale = Double(maxLongEdge) / Double(longEdge)
    let width = Int((Double(image.width) * scale).rounded())
    let height = Int((Double(image.height) * scale).rounded())
    guard width > 0, height > 0,
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }

  private static func encodeJPEG(_ image: CGImage) -> Data? {
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.72]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
  }
}
