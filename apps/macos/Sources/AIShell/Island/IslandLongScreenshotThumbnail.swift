import AICore
import CoreGraphics

/// The long screenshot card's preview images, which its lightbox's overview and motion draw too:
/// the whole stitched image scaled down once, off the main actor (a long image can be tens of
/// thousands of pixels tall), the same with its sensitive parts pixelated once the card covers
/// them, and either with what was drawn on the image in the lightbox. The cover's blocks and the
/// annotations' mosaics are the screenshot editor's own (``AnnotationMosaic``), averaged from the
/// full-resolution image and then scaled down with it, so the preview shows what the image Atd
/// receives has.
enum IslandLongScreenshotThumbnail {
  /// `image` scaled to `width` × `height` pixels; nil when either is not positive.
  @concurrent
  static func make(_ image: CGImage, width: Int, height: Int) async -> CGImage? {
    guard width > 0, height > 0, let context = context(width: width, height: height, like: image)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }

  /// `thumbnail` of `shot` with `areas` (image points, origin top-left) pixelated.
  static func covered(_ thumbnail: CGImage, shot: LongScreenshotImage, areas: [CGRect])
    -> CGImage?
  {
    guard
      let context = context(width: thumbnail.width, height: thumbnail.height, like: thumbnail)
    else { return nil }
    let bounds = CGRect(x: 0, y: 0, width: thumbnail.width, height: thumbnail.height)
    context.draw(thumbnail, in: bounds)
    let scale = Double(thumbnail.width) / max(shot.pointSize.width, 1)
    // Image points, top-left, to the thumbnail's bottom-left pixels.
    let place: (CGRect) -> CGRect = { rect in
      CGRect(
        x: rect.minX * scale, y: bounds.height - rect.maxY * scale, width: rect.width * scale,
        height: rect.height * scale)
    }
    let mosaic = AnnotationMosaic()
    context.interpolationQuality = .none
    for area in areas {
      guard
        let (blocks, covered) = mosaic.render(
          area, style: LongScreenshotCardState.coverStyle, backdrop: shot.image,
          scale: shot.scale, opaque: true)
      else { continue }
      context.saveGState()
      context.clip(to: place(area))
      context.draw(blocks, in: place(covered))
      context.restoreGState()
    }
    return context.makeImage()
  }

  /// `base` (a preview image of `shot`, covered or not) with `annotations` (image points, origin
  /// top-left) drawn over it at its scale, off the main actor, by the renderer the lightbox's
  /// canvas and the export draw with, mosaics sampling the long image itself; nil when no bitmap
  /// could be made.
  @concurrent
  static func annotated(
    _ base: CGImage, shot: LongScreenshotImage, annotations: AnnotationDocument
  ) async -> CGImage? {
    guard let context = context(width: base.width, height: base.height, like: base) else {
      return nil
    }
    let bounds = CGRect(x: 0, y: 0, width: base.width, height: base.height)
    context.draw(base, in: bounds)
    let whole = CGRect(origin: .zero, size: shot.pointSize)
    // Image points, y down, to the thumbnail's pixels, y up; each axis by its own rounding.
    context.translateBy(x: 0, y: bounds.height)
    context.scaleBy(
      x: bounds.width / max(whole.width, 1), y: -bounds.height / max(whole.height, 1))
    context.clip(to: whole)
    let backdrop = CaptureBackdrop(
      image: shot.image, scale: shot.scale, origin: .zero, frames: [whole])
    AnnotationRenderer().draw(annotations, in: context, backdrop: backdrop)
    return context.makeImage()
  }

  /// A bitmap in `image`'s own RGB space (sRGB otherwise), so scaling keeps its colours.
  nonisolated private static func context(width: Int, height: Int, like image: CGImage)
    -> CGContext?
  {
    let space =
      image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil }
      ?? CGColorSpace(name: CGColorSpace.sRGB)
    guard let space else { return nil }
    return CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  }
}
