import AICore
import CoreImage
import CoreImage.CIFilterBuiltins

/// Mosaic regions: `CIPixellate` over the screenshot's own pixels (never over other
/// annotations), so the exported image holds only the blocks. Results are cached per region,
/// because the live canvas redraws on every pointer move and selection change while the
/// backdrop stays the same.
@MainActor
final class AnnotationMosaic {
  private struct Key: Hashable {
    let backdrop: ObjectIdentifier
    let x: Int, y: Int, width: Int, height: Int, block: Int
  }

  private let context = CIContext(options: [.cacheIntermediates: false])
  private var cache: [Key: CGImage] = [:]
  private var cachedBackdrop: ObjectIdentifier?

  /// The pixelated pixels of `rect` (view points) and the point rect they cover, which is
  /// `rect` snapped outward to whole backdrop pixels and clipped to the backdrop; `stroke` sets
  /// how coarse the blocks are. `backdrop` is the frozen display's image with `scale` pixels per
  /// point, so a region's blocks do not depend on where the selection is; nil when the region
  /// is off the image.
  func pixelate(_ rect: CGRect, stroke: AnnotationStroke, backdrop: CGImage, scale: CGFloat)
    -> (CGImage, CGRect)?
  {
    let imageBounds = CGRect(x: 0, y: 0, width: backdrop.width, height: backdrop.height)
    let pixels = CGRect(
      x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale,
      height: rect.height * scale
    ).integral.intersection(imageBounds)
    guard !pixels.isNull, pixels.width >= 1, pixels.height >= 1 else { return nil }
    let blockPoints = AnnotationPath.mosaicBlock(for: rect, stroke: stroke)
    let block = max(1, Int((blockPoints * scale).rounded()))
    let identity = ObjectIdentifier(backdrop)
    if cachedBackdrop != identity || cache.count > 64 {
      cache.removeAll()
      cachedBackdrop = identity
    }
    let key = Key(
      backdrop: identity, x: Int(pixels.minX), y: Int(pixels.minY), width: Int(pixels.width),
      height: Int(pixels.height), block: block)
    let points = CGRect(
      x: pixels.minX / scale, y: pixels.minY / scale, width: pixels.width / scale,
      height: pixels.height / scale)
    if let image = cache[key] { return (image, points) }
    guard let image = render(pixels, block: block, backdrop: backdrop) else { return nil }
    cache[key] = image
    return (image, points)
  }

  /// Core Image's origin is bottom-left, so the top-left pixel rect is flipped first. The
  /// region is clamped before filtering so edge blocks repeat the region's own pixels instead of
  /// fading to transparent, and the block grid is anchored at the region's top-left corner.
  private func render(_ pixels: CGRect, block: Int, backdrop: CGImage) -> CGImage? {
    let flipped = CGRect(
      x: pixels.minX, y: CGFloat(backdrop.height) - pixels.maxY, width: pixels.width,
      height: pixels.height)
    let filter = CIFilter.pixellate()
    filter.inputImage = CIImage(cgImage: backdrop).cropped(to: flipped).clampedToExtent()
    filter.scale = Float(block)
    filter.center = CGPoint(x: flipped.minX, y: flipped.maxY)
    guard let output = filter.outputImage?.cropped(to: flipped) else { return nil }
    let space = backdrop.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    return context.createCGImage(output, from: flipped, format: .RGBA8, colorSpace: space)
  }
}
