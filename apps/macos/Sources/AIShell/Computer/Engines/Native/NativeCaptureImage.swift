import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The pixel work on a window capture the native engine does itself: decoding the driver's
/// off-Space JPEG, bounding a whole-window image to the observation's long edge, cutting a
/// surface or region out of it, and encoding (PNG for observations, JPEG for the off-Space
/// preview). Cutting never rescales, so a cut image keeps the source image's pixels per point.
nonisolated enum NativeCaptureImage {
  static func decode(base64: String) -> CGImage? {
    guard let data = Data(base64Encoded: base64),
      let source = CGImageSourceCreateWithData(data as CFData, nil)
    else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  /// `rect` (pixels, top-left origin) of `image`, as PNG base64; nil when it is empty or
  /// encoding fails.
  static func crop(_ image: CGImage, to rect: CGRect) -> (image: CGImage, base64: String)? {
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let clipped = rect.integral.intersection(bounds)
    guard !clipped.isNull, !clipped.isEmpty, let cut = image.cropping(to: clipped),
      let base64 = png(cut)
    else { return nil }
    return (cut, base64)
  }

  /// `image` scaled down so its long edge is at most `longEdge` pixels; as it is when smaller.
  static func bounded(_ image: CGImage, longEdge: Int) -> CGImage {
    let edge = max(image.width, image.height)
    guard edge > longEdge else { return image }
    let ratio = Double(longEdge) / Double(edge)
    let width = max(1, Int((Double(image.width) * ratio).rounded()))
    let height = max(1, Int((Double(image.height) * ratio).rounded()))
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return image }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage() ?? image
  }

  /// A JPEG preview frame.
  struct Frame: Sendable {
    let width: Int
    let height: Int
    let data: Data
  }

  /// A preview frame of a window image of a window `size` points large: `crop` (points from the
  /// window's top-left corner) cut out, bounded to `longEdge` and encoded as JPEG of at most
  /// 1 MiB; nil when the cut is empty or encoding fails.
  static func previewFrame(_ image: CGImage, size: CGSize, crop: CGRect?, longEdge: Int)
    -> Frame?
  {
    guard size.width > 0, size.height > 0 else { return nil }
    var source = image
    if let crop {
      let scaleX = Double(image.width) / size.width
      let scaleY = Double(image.height) / size.height
      let rect = CGRect(
        x: crop.minX * scaleX, y: crop.minY * scaleY, width: crop.width * scaleX,
        height: crop.height * scaleY
      ).integral.intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
      guard !rect.isNull, !rect.isEmpty, let cut = image.cropping(to: rect) else { return nil }
      source = cut
    }
    let scaled = bounded(source, longEdge: longEdge)
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, scaled, [kCGImageDestinationLossyCompressionQuality: 0.6] as CFDictionary)
    guard CGImageDestinationFinalize(destination), data.length <= 1_048_576 else { return nil }
    return Frame(width: scaled.width, height: scaled.height, data: data as Data)
  }

  static func png(_ image: CGImage) -> String? {
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        data as CFMutableData, UTType.png.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return (data as Data).base64EncodedString()
  }
}
