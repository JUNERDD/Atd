import CoreGraphics
import Foundation

/// How a long screenshot leaves its result card (decisions D8, D12): the image file it is
/// attached or asked about as, the parts its cover hides, its copy, and the names the user sees.
///
/// Unlike a screenshot's (``ScreenshotRules``), the file keeps its full resolution, so its text
/// stays legible once the service reads it as pages (``LongScreenshotPages``): only its width is
/// capped, at ``maxPixelWidth``, and its area at ``maxPixels``. It is encoded as PNG, then as
/// JPEG of the same size, then shrunk by a quarter at a time, until it is within
/// ``maxImageBytes``. A copy keeps every pixel (it is no file), as PNG, and as TIFF too while
/// that stays within ``clipboardTIFFMaxPixels``.
public enum LongScreenshotExportRules {
  /// The widest file. A long screenshot is one selection wide, so only an unusually wide one on
  /// a Retina display is scaled.
  public static let maxPixelWidth = ScreenshotRules.maxLongEdge
  /// The most pixels the service passes on as image input (`MAX_IMAGE_PIXELS`,
  /// apps/agent-service/src/file-loader/image-size.ts): a larger file would reach the model as a
  /// description only, so a longer image is scaled down to fit. By then its pages are scaled far
  /// below this anyway.
  public static let maxPixels = 100_000_000
  /// The encoded file's budget, well under the service's attachment limit
  /// (`MAX_ATTACHMENT_BYTES`, 64 MiB).
  public static let maxImageBytes = 32 * 1024 * 1024
  /// JPEG fallbacks shrink no narrower than this; below it the image is refused.
  public static let minimumFallbackWidth = 640
  /// The most pixels a copy also puts on the clipboard as TIFF, which a screenshot's copy offers
  /// beside PNG for older readers: uncompressed, as AppKit writes it, it takes four bytes a pixel,
  /// so 64 MB here, and hundreds of megabytes for a long screenshot of many screens. A longer copy
  /// is PNG only, which every current app reads.
  public static let clipboardTIFFMaxPixels = 16_000_000

  // MARK: Encoding

  /// The first encoding of a `width` × `height` kept image: PNG at full resolution, within
  /// ``maxPixelWidth`` and ``maxPixels``. The long edge is the one `CaptureExport` scales by
  /// (``ScreenshotRules/pixelSize(width:height:longEdge:)``), so the file's size is exactly what
  /// ``pixelSize(width:height:attempt:)`` says.
  public static func firstAttempt(width: Int, height: Int) -> ScreenshotAttempt {
    let long = max(width, height, 1)
    var edge = long
    if width > maxPixelWidth {
      edge = min(edge, Int(Double(long) * Double(maxPixelWidth) / Double(width)))
    }
    let area = Double(width) * Double(height)
    if area > Double(maxPixels) {
      edge = min(edge, Int(Double(long) * (Double(maxPixels) / area).squareRoot()))
    }
    // The other side is rounded, which can tip it one pixel over a cap.
    while edge > 1, !fits(ScreenshotRules.pixelSize(width: width, height: height, longEdge: edge)) {
      edge -= 1
    }
    return ScreenshotAttempt(encoding: .png, longEdge: max(1, edge))
  }

  /// What follows an attempt that produced `bytes`: keep it when it fits ``maxImageBytes``;
  /// otherwise the PNG becomes a JPEG of the same size, and a JPEG shrinks by a quarter until it
  /// would be narrower than ``minimumFallbackWidth``, after which the image is refused.
  public static func step(after attempt: ScreenshotAttempt, width: Int, height: Int, bytes: Int)
    -> ScreenshotEncodingStep
  {
    guard bytes > maxImageBytes else { return .keep }
    switch attempt.encoding {
    case .png:
      return .retry(ScreenshotAttempt(encoding: .jpeg, longEdge: attempt.longEdge))
    case .jpeg:
      let next = ScreenshotAttempt(encoding: .jpeg, longEdge: attempt.longEdge * 3 / 4)
      guard pixelSize(width: width, height: height, attempt: next).width >= minimumFallbackWidth
      else { return .giveUp }
      return .retry(next)
    }
  }

  /// The file's pixel size for `attempt` on a `width` × `height` kept image.
  public static func pixelSize(width: Int, height: Int, attempt: ScreenshotAttempt)
    -> ScreenshotPixelSize
  {
    ScreenshotRules.pixelSize(width: width, height: height, longEdge: attempt.longEdge)
  }

  private static func fits(_ size: ScreenshotPixelSize) -> Bool {
    size.width <= maxPixelWidth && size.width * size.height <= maxPixels
  }

  // MARK: Names

  /// The image's name: the screenshot's
  /// (``ScreenshotRules/fileName(capturedAt:encoding:timeZone:)``) with ` long` before the
  /// extension, `Screenshot 2026-10-01 at 10.16.11 long.png`. English like the screenshot's,
  /// because the page and the model read it.
  public static func fileName(
    capturedAt date: Date, encoding: ScreenshotEncoding = .png, timeZone: TimeZone = .current
  ) -> String {
    stem(capturedAt: date, timeZone: timeZone) + "." + encoding.fileExtension
  }

  /// The context imported beside it: its name with ` context.md` in place of the extension, which
  /// is also what marks it as a capture's context in the composer (`isCaptureContext`).
  public static func contextFileName(capturedAt date: Date, timeZone: TimeZone = .current)
    -> String
  {
    stem(capturedAt: date, timeZone: timeZone) + " context.md"
  }

  private static func stem(capturedAt date: Date, timeZone: TimeZone) -> String {
    let encoding = ScreenshotEncoding.png
    let name = ScreenshotRules.fileName(capturedAt: date, encoding: encoding, timeZone: timeZone)
    return String(name.dropLast(encoding.fileExtension.count + 1)) + " long"
  }

  // MARK: The cover

  /// What `kept` of `source` covers, in image points, by the card's own recipe so the copy, the
  /// file and its context hide exactly what the card's preview shows covered: each sensitive part
  /// that shows in the range, even one a handle cuts through (``LongScreenshotKept/touches(_:)``),
  /// grown as ``LongScreenshotCardState/coverRect(_:)`` grows it. Empty when the range is not
  /// covered.
  public static func coveredAreas(of source: LongScreenshotCardSource, kept: LongScreenshotKept)
    -> [CGRect]
  {
    guard kept.covered else { return [] }
    return source.sensitive.filter { kept.touches($0.box) }.map {
      LongScreenshotCardState.coverRect($0.box)
    }
  }
}
