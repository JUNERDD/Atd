import AICore
import AppKit
import CoreGraphics

/// A long screenshot's pixels as they leave its result card (decisions D8, D12): the kept range
/// cut from the stitched image with its sensitive parts pixelated as the card's preview covers
/// them and what was drawn on it in the lightbox, the file written through the one image encoder
/// under ``LongScreenshotExportRules``, and the copy at full pixels. A long image takes seconds to
/// compose and encode, so all of it but the cover's blocks and the pasteboard write runs off the
/// main actor, the annotations too (``AnnotationRenderer`` is nonisolated).
extension CaptureExport {
  /// Pixelated blocks over one covered part, in the kept image's pixels (origin top-left): the
  /// blocks are drawn into `area` and show only inside `clip`, the part itself.
  nonisolated struct LongScreenshotPatch: Sendable {
    let blocks: CGImage
    let area: CGRect
    let clip: CGRect
  }

  /// A kept image encoded for the clipboard (``longScreenshotClipboard(_:scale:)``).
  nonisolated struct LongScreenshotClipboard: Sendable {
    let png: Data
    /// Nil past ``LongScreenshotExportRules/clipboardTIFFMaxPixels``.
    let tiff: Data?
  }

  /// The patches covering `kept` of `source` (none when it is not covered): the card's cover
  /// (``LongScreenshotExportRules/coveredAreas(of:kept:)`` in
  /// ``LongScreenshotCardState/coverStyle``), on a grid fixed to the whole image, so the pixels
  /// match the card's preview. `mosaic` keeps the image's block grid between calls.
  static func longScreenshotCover(
    _ source: LongScreenshotCardSource, kept: LongScreenshotKept, mosaic: AnnotationMosaic
  ) -> [LongScreenshotPatch] {
    let shot = source.shot
    let top = keptRows(of: shot, kept: kept).lowerBound
    func pixels(_ rect: CGRect) -> CGRect {
      CGRect(
        x: rect.minX * shot.scale, y: rect.minY * shot.scale - CGFloat(top),
        width: rect.width * shot.scale, height: rect.height * shot.scale)
    }
    let areas = LongScreenshotExportRules.coveredAreas(of: source, kept: kept)
    return areas.compactMap { area in
      guard
        let (blocks, covered) = mosaic.render(
          area, style: LongScreenshotCardState.coverStyle, backdrop: shot.image,
          scale: shot.scale, opaque: true)
      else { return nil }
      return LongScreenshotPatch(blocks: blocks, area: pixels(covered), clip: pixels(area))
    }
  }

  /// The pixel rows of `shot` that `kept` keeps, at least one.
  nonisolated static func keptRows(of shot: LongScreenshotImage, kept: LongScreenshotKept)
    -> Range<Int>
  {
    let height = shot.image.height
    let top = min(max(0, Int((kept.top * shot.scale).rounded())), height - 1)
    let bottom = min(height, max(top + 1, Int((kept.bottom * shot.scale).rounded())))
    return top..<bottom
  }

  /// The kept image: `kept`'s rows of `shot` with `cover` drawn in, then `kept`'s annotations
  /// over them at the image's own pixels (``longScreenshotAnnotations(_:of:rows:in:)``); nil when
  /// it could not be drawn. With neither it is a crop of the stitched pixels.
  @concurrent
  nonisolated static func longScreenshotKept(
    _ shot: LongScreenshotImage, kept: LongScreenshotKept, cover: [LongScreenshotPatch]
  ) async -> CGImage? {
    let rows = keptRows(of: shot, kept: kept)
    let width = shot.image.width
    guard
      let crop = shot.image.cropping(
        to: CGRect(x: 0, y: rows.lowerBound, width: width, height: rows.count))
    else { return nil }
    guard !cover.isEmpty || !kept.annotations.isEmpty else { return crop }
    guard let context = bitmap(width: width, height: rows.count, like: shot.image) else {
      return nil
    }
    let height = CGFloat(rows.count)
    // The context's origin is at the bottom-left; the patches' at the top-left.
    func flipped(_ rect: CGRect) -> CGRect {
      CGRect(x: rect.minX, y: height - rect.maxY, width: rect.width, height: rect.height)
    }
    context.draw(crop, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: height))
    context.interpolationQuality = .none
    for patch in cover {
      context.saveGState()
      context.clip(to: flipped(patch.clip))
      context.draw(patch.blocks, in: flipped(patch.area))
      context.restoreGState()
    }
    longScreenshotAnnotations(kept.annotations, of: shot, rows: rows, in: context)
    return context.makeImage()
  }

  /// Draws `document` (image points, origin top-left) into `context`, the kept image of `rows`
  /// of `shot`'s pixels (origin bottom-left), clipped to the rows, as the canvas shows it in the
  /// lightbox: with the renderer the canvas draws with, its mosaics sampling the long image
  /// itself, so their blocks sit on the grid the canvas shows and never on the cover.
  nonisolated private static func longScreenshotAnnotations(
    _ document: AnnotationDocument, of shot: LongScreenshotImage, rows: Range<Int>,
    in context: CGContext
  ) {
    guard !document.isEmpty else { return }
    let whole = CGRect(origin: .zero, size: shot.pointSize)
    let top = CGFloat(rows.lowerBound) / shot.scale
    context.saveGState()
    // Image points, y down, to the kept image's pixels, y up.
    context.translateBy(x: 0, y: CGFloat(rows.count))
    context.scaleBy(x: shot.scale, y: -shot.scale)
    context.translateBy(x: 0, y: -top)
    context.clip(
      to: CGRect(x: 0, y: top, width: whole.width, height: CGFloat(rows.count) / shot.scale))
    let backdrop = CaptureBackdrop(
      image: shot.image, scale: shot.scale, origin: .zero, frames: [whole])
    AnnotationRenderer().draw(document, in: context, backdrop: backdrop)
    context.restoreGState()
  }

  /// Writes a kept image into `folder` as the long screenshot's file and returns it with its
  /// pixel size, which its context's pages follow.
  @concurrent
  nonisolated static func storeLongScreenshot(_ image: CGImage, capturedAt: Date, in folder: URL)
    async throws(ImageExportFailure) -> (file: URL, size: ScreenshotPixelSize)
  {
    let (width, height) = (image.width, image.height)
    var attempt = LongScreenshotExportRules.firstAttempt(width: width, height: height)
    while true {
      let data = try encode(image, as: attempt)
      switch LongScreenshotExportRules.step(
        after: attempt, width: width, height: height, bytes: data.count)
      {
      case .keep:
        let name = LongScreenshotExportRules.fileName(
          capturedAt: capturedAt, encoding: attempt.encoding)
        let file = folder.appending(path: name)
        do {
          try data.write(to: file)
        } catch {
          throw .unwritable
        }
        let size = LongScreenshotExportRules.pixelSize(
          width: width, height: height, attempt: attempt)
        return (file, size)
      case .retry(let next):
        attempt = next
      case .giveUp:
        throw .tooLarge
      }
    }
  }

  /// A kept image (`scale` pixels per point) for the clipboard at its full pixel size, sized in
  /// points so it pastes at screen size like a screenshot (``copy(_:pixelScale:to:)``): PNG, and
  /// TIFF as well within ``LongScreenshotExportRules/clipboardTIFFMaxPixels``. Encoding a long
  /// image takes seconds, so it runs here rather than in the clipboard write. Nil when no PNG
  /// could be made.
  @concurrent
  nonisolated static func longScreenshotClipboard(_ image: CGImage, scale: CGFloat) async
    -> LongScreenshotClipboard?
  {
    let bitmap = NSBitmapImageRep(cgImage: image)
    bitmap.size = NSSize(
      width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
    guard let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
    let tiffs = image.width * image.height <= LongScreenshotExportRules.clipboardTIFFMaxPixels
    return LongScreenshotClipboard(png: png, tiff: tiffs ? bitmap.tiffRepresentation : nil)
  }

  /// Puts an encoded kept image on `pasteboard`; called inside the arbiter's clipboard write.
  static func copy(_ clipboard: LongScreenshotClipboard, to pasteboard: NSPasteboard) {
    pasteboard.clearContents()
    pasteboard.declareTypes(clipboard.tiff == nil ? [.png] : [.png, .tiff], owner: nil)
    pasteboard.setData(clipboard.png, forType: .png)
    if let tiff = clipboard.tiff { pasteboard.setData(tiff, forType: .tiff) }
  }
}
