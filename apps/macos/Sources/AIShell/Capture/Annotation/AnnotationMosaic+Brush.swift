import AICore
import AppKit
import CoreGraphics

nonisolated extension AnnotationMosaic {
  /// Renders pixelated or blurred backdrop clipped to a freehand stroke path around `points`.
  func renderBrushMask(
    _ points: [CGPoint],
    style: AnnotationStyle,
    backdrop: CaptureBackdrop
  ) -> (image: CGImage, area: CGRect, strokePath: CGPath)? {
    guard !points.isEmpty else { return nil }
    let brushWidth = style.stroke.highlighterWidth
    let rawBounds = AnnotationMath.rect(enclosing: points)
      .insetBy(dx: -(brushWidth / 2 + 4), dy: -(brushWidth / 2 + 4))
    let localRect = rawBounds.offsetBy(dx: -backdrop.origin.x, dy: -backdrop.origin.y)
    let segments = AnnotationPath.smoothed(points)
    let basePath = AnnotationRenderer.path(segments)
    let stroked = basePath.copy(
      strokingWithWidth: brushWidth,
      lineCap: .round,
      lineJoin: .round,
      miterLimit: 4)
    guard
      let (image, area) = render(
        localRect,
        style: style,
        backdrop: backdrop.image,
        scale: backdrop.scale,
        opaque: backdrop.isOpaque)
    else { return nil }
    let placed = area.offsetBy(dx: backdrop.origin.x, dy: backdrop.origin.y)
    return (image, placed, stroked)
  }
}
