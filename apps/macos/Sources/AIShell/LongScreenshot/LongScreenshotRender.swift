import AICore
import CoreGraphics
import Foundation

/// Draws a long screenshot's ``LongScreenshotLayout``: at the display's own pixels when it
/// finishes (scaled down uniformly to at most ``LongScreenshotExportRules/maxPixelWidth`` wide,
/// which bounds its memory near four bytes for each of ``LongScreenshotExportRules/maxPixels``),
/// and from thumbnails for the preview strip.
nonisolated enum LongScreenshotRender {
  /// What a finished capture hands over to be put together: every pixel it kept, moved out of
  /// the engine so nothing stays behind it.
  struct Parts: Sendable {
    let layout: LongScreenshotLayout
    let first: LongScreenshotRows
    let head: LongScreenshotRows?
    let tail: LongScreenshotRows?
    let strips: [LongScreenshotStrips.Chunk]
    let space: CGColorSpace
  }

  /// Images of every source at one resolution: `scale` source pixels per image pixel.
  struct Sources {
    var scale: CGFloat
    var first: CGImage?
    var head: CGImage?
    var tail: CGImage?
    /// The strips' chunks: their document rows, and their image, made when drawn.
    var strips: [(range: Range<Int>, image: () -> CGImage?)]
  }

  /// A finished image and its pixels per point.
  struct Composed: Sendable {
    let image: CGImage
    let scale: CGFloat
  }

  /// The finished image, off the main actor: the layout's pixels (`pointScale` per point), or,
  /// when it is wider than ``LongScreenshotExportRules/maxPixelWidth``, all of it scaled down
  /// uniformly to that width (with its scale reduced alike, so every size read from it stays
  /// consistent). Nil when its bitmap cannot be allocated or made into an image, so a failure
  /// reaches the caller instead of trapping. Chunks are decompressed one at a time while drawing.
  @concurrent
  static func compose(_ parts: Parts, pointScale: CGFloat) async -> Composed? {
    let layout = parts.layout
    guard layout.width > 0, layout.height > 0 else { return nil }
    let factor = min(1, CGFloat(LongScreenshotExportRules.maxPixelWidth) / CGFloat(layout.width))
    let width = factor < 1 ? LongScreenshotExportRules.maxPixelWidth : layout.width
    let height = max(1, Int((CGFloat(layout.height) * factor).rounded()))
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: parts.space, bitmapInfo: LongScreenshotRows.bitmapInfo.rawValue)
    else { return nil }
    // Unscaled pieces are copied pixel for pixel; scaled ones get the best resampling.
    context.interpolationQuality = factor < 1 ? .high : .none
    let rowWidth = parts.first.width
    let space = parts.space
    let sources = Sources(
      scale: 1, first: parts.first.image(in: space), head: parts.head?.image(in: space),
      tail: parts.tail?.image(in: space),
      strips: parts.strips.map { chunk in
        (chunk.range, { LongScreenshotStrips.pixels(of: chunk, width: rowWidth)?.image(in: space) })
      })
    draw(layout, from: sources, into: context, scale: CGFloat(height) / CGFloat(layout.height))
    guard let image = context.makeImage() else { return nil }
    return Composed(
      image: image, scale: pointScale * CGFloat(width) / CGFloat(layout.width))
  }

  /// The layout scaled to fit `size` points at `backing` pixels per point, from `sources`
  /// (thumbnails); nil when the layout is empty.
  static func preview(
    _ layout: LongScreenshotLayout, from sources: Sources, fitting size: CGSize, backing: CGFloat,
    space: CGColorSpace
  ) -> CGImage? {
    guard layout.width > 0, layout.height > 0, size.width > 0, size.height > 0 else { return nil }
    let fit = min(
      size.width * backing / CGFloat(layout.width), size.height * backing / CGFloat(layout.height))
    let width = max(1, Int((CGFloat(layout.width) * fit).rounded()))
    let height = max(1, Int((CGFloat(layout.height) * fit).rounded()))
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: LongScreenshotRows.bitmapInfo.rawValue)
    else { return nil }
    context.interpolationQuality = .medium
    draw(layout, from: sources, into: context, scale: CGFloat(height) / CGFloat(layout.height))
    return context.makeImage()
  }

  /// Draws every piece at `scale` destination pixels per image pixel.
  static func draw(
    _ layout: LongScreenshotLayout, from sources: Sources, into context: CGContext, scale: CGFloat
  ) {
    let height = CGFloat(layout.height) * scale
    // Scaled, pieces meet inside a pixel: without antialiasing each pixel takes the piece its
    // centre falls in, so no strip's edge blends with the empty bitmap (a seam), and every
    // piece keeps the one uniform scale.
    context.setShouldAntialias(false)
    // Core Graphics counts up from the bottom; the layout counts down from the top.
    func place(_ image: CGImage?, rows: Range<Int>, top: Int, tall: Int, columns: Range<Int>) {
      guard let image, let part = crop(image, rows: rows, columns: columns, scale: sources.scale)
      else { return }
      context.draw(
        part,
        in: CGRect(
          x: CGFloat(columns.lowerBound) * scale, y: height - CGFloat(top + tall) * scale,
          width: CGFloat(columns.count) * scale, height: CGFloat(tall) * scale))
    }
    for piece in layout.pieces {
      switch piece.source {
      case .first, .head, .tail:
        let image =
          piece.source == .first
          ? sources.first : piece.source == .head ? sources.head : sources.tail
        place(image, rows: piece.rows, top: piece.top, tall: piece.height, columns: piece.columns)
      case .strips:
        for strip in sources.strips {
          let overlap = strip.range.clamped(to: piece.rows)
          guard !overlap.isEmpty else { continue }
          place(
            strip.image(),
            rows: (overlap.lowerBound - strip.range.lowerBound)..<(overlap.upperBound
              - strip.range.lowerBound),
            top: piece.top + overlap.lowerBound - piece.rows.lowerBound, tall: overlap.count,
            columns: piece.columns)
        }
      }
    }
  }

  /// `rows` × `columns` (image pixels) of `image`, whose pixels are `scale` per image pixel,
  /// widened to whole pixels of it and at least one each way.
  private static func crop(_ image: CGImage, rows: Range<Int>, columns: Range<Int>, scale: CGFloat)
    -> CGImage?
  {
    let left = (CGFloat(columns.lowerBound) * scale).rounded(.down)
    let top = (CGFloat(rows.lowerBound) * scale).rounded(.down)
    let right = max(left + 1, (CGFloat(columns.upperBound) * scale).rounded(.up))
    let bottom = max(top + 1, (CGFloat(rows.upperBound) * scale).rounded(.up))
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let rect = CGRect(x: left, y: top, width: right - left, height: bottom - top)
      .intersection(bounds)
    return rect.isNull || rect.isEmpty ? nil : image.cropping(to: rect)
  }
}
