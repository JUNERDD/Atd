import AICore
import CoreGraphics
import Foundation
import ImageIO

/// Turns the bitmap of a paste into the file that is imported. Decoding is this type's; scaling
/// to ``ScreenshotRules/maxLongEdge`` and the PNG-then-JPEG encoding are the screenshot export's
/// (``CaptureExport/write(_:in:name:)``), so pasted images and captures follow one rule, under the
/// pasted image's own name and failure reasons.
enum PastedImageExport {
  enum Failure: Error {
    /// The pasteboard data is not an image ImageIO can decode, or it could not be written.
    case unreadable
    /// Even the smallest fallback is over the service's image limit.
    case tooLarge
  }

  /// Decodes `data`, writes the stored image into `folder` and returns the file. Decoding,
  /// scaling and encoding a Retina screenshot take long enough to keep them off the main actor.
  @concurrent
  nonisolated static func store(_ data: Data, pastedAt: Date, in folder: URL)
    async throws(Failure) -> URL
  {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw .unreadable }
    do {
      return try await CaptureExport.write(image, in: folder) { encoding in
        PastedImageName.fileName(pastedAt: pastedAt, encoding: encoding)
      }
    } catch .tooLarge {
      throw .tooLarge
    } catch {
      throw .unreadable
    }
  }
}
