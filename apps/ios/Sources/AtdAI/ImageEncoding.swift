import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Prepares a photo or screenshot for a model, the same way wherever it comes from (问 Atd, the
/// share sheet, the camera): upright, at most `maxPixels` on its long side, as JPEG.
///
/// It reads a thumbnail straight from the encoded data, so a full-size photo is never decoded
/// whole, which keeps extensions inside their memory limits.
public enum ImageEncoding {
  /// The long side providers take without scaling down themselves (Anthropic's limit).
  public static let maxPixels = 1568
  static let quality = 0.8

  /// The image as a JPEG `ModelImage`; a smaller image keeps its size. Nil for data ImageIO
  /// cannot read. Runs off the caller's actor, since a large photo takes a moment.
  @concurrent
  public static func modelImage(from data: Data) async -> ModelImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    let output = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        output, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return ModelImage(data: output as Data, mediaType: "image/jpeg")
  }
}
