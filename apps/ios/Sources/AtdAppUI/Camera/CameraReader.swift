import AtdAI
import CoreGraphics
import Foundation
import ImageIO
import Vision

/// A photo the camera is reading: the upright image the stage draws, and the text lines found
/// on it, numbered for the model.
nonisolated struct CameraShot {
  let image: CGImage
  let lines: [CameraTextLine]

  var size: CGSize { CGSize(width: image.width, height: image.height) }
}

/// Reads a photo on device before anything is sent: decodes it upright and finds its text with
/// Vision. Nothing here leaves the phone.
nonisolated enum CameraReader {
  /// The long side the photo is decoded at, for the stage and for text recognition.
  static let maxPixels = 2560

  /// The photo upright, its text lines numbered; nil when the data is not an image.
  @concurrent
  static func read(_ photo: Data) async -> CameraShot? {
    guard let image = upright(photo) else { return nil }
    let lines = await recognize(image)
    return CameraShot(image: image, lines: lines)
  }

  /// Decodes `photo` with its orientation applied, its long side at most `maxPixels`.
  static func upright(_ photo: Data) -> CGImage? {
    guard let source = CGImageSourceCreateWithData(photo as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  /// The text Vision finds on `image`, in reading order; none when recognition fails.
  static func recognize(_ image: CGImage) async -> [CameraTextLine] {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    guard let observations = try? await request.perform(on: image) else { return [] }
    let recognized = observations.compactMap { observation -> CameraRecognizedText? in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let quad = CameraQuad(
        visionTopLeft: point(observation.topLeft), topRight: point(observation.topRight),
        bottomRight: point(observation.bottomRight), bottomLeft: point(observation.bottomLeft))
      return CameraRecognizedText(
        text: candidate.string, confidence: candidate.confidence, quad: quad)
    }
    return CameraText.lines(from: recognized)
  }

  private static func point(_ point: NormalizedPoint) -> CGPoint {
    CGPoint(x: point.x, y: point.y)
  }
}
