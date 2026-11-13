import CoreGraphics
import Foundation

/// How a long screenshot leaves its result card (decisions D8, D12): the image file it is
/// attached or asked about as, its copy (the whole kept range, or the segment a text command
/// changed), and the names the user sees.
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

  // MARK: A segment

  /// How far a copied segment reaches past the changes it holds, above and below (points).
  public static let segmentMargin: CGFloat = 16

  /// The stretch of `kept` that holds `areas` (image points: what a text command changed on the
  /// image), for Copy Screenshot on the full-screen preview's result card (decision D9): the rows
  /// from the areas' top to their bottom grown by ``segmentMargin``, on whole points, within the
  /// kept range, the image's whole width, with the same annotations, so the copy draws the changes
  /// as the preview shows them. A long screenshot is too long to share whole for one change; the
  /// bottom bar's Copy copies the whole kept range. The whole kept range when no area lies in it.
  public static func segment(holding areas: [CGRect], of kept: LongScreenshotKept)
    -> LongScreenshotKept
  {
    let rows = areas.map(\.standardized).filter { $0.maxY > kept.top && $0.minY < kept.bottom }
      .reduce(CGRect.null) { $0.union($1) }
    guard !rows.isNull else { return kept }
    let top = max(kept.top, (rows.minY - segmentMargin).rounded(.down))
    let bottom = min(kept.bottom, (rows.maxY + segmentMargin).rounded(.up))
    guard bottom > top else { return kept }
    return LongScreenshotKept(top: top, bottom: bottom, annotations: kept.annotations)
  }
}
