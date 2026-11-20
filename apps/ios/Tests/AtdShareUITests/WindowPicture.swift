import UIKit

/// Draws a window's screen in a test process for the share sheet's snapshots.
///
/// A test process cannot draw Liquid Glass: `drawHierarchy` needs a window on a screen, and
/// `CALayer.render(in:)` draws nothing at all while the tree holds glass's signed-distance-field
/// layers (UIKit's `CASDFLayer`, SwiftUI's `SDFLayer`), and leaves out the content a portal shows
/// elsewhere (a scroll edge's blur over a list that runs under a bar). So those layers are hidden
/// while the window is drawn; each glass shape (a SwiftUI glass button, a bar button's platter) is
/// then drawn as a gray stand-in with its content on top, and content that bars color through a
/// vibrancy filter (titles, bar glyphs), which `render(in:)` leaves white, is drawn in the label
/// color. The pictures show layout, copy and states, not the glass material.
@MainActor enum WindowPicture {
  static func image(of window: UIWindow, scale: CGFloat) -> UIImage {
    let root = window.layer
    let traits = window.rootViewController?.view.traitCollection ?? window.traitCollection
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    return UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { renderer in
      let context = renderer.cgContext
      let glass = glassLayers(in: root)
      for layer in glass { layer.isHidden = true }
      root.render(in: context)
      for layer in glass { layer.isHidden = false }

      for shape in layers(in: root, where: isShape) {
        let frame = shape.convert(shape.bounds, to: root)
        UIColor.systemGray.resolvedColor(with: traits).setFill()
        UIBezierPath(roundedRect: frame, cornerRadius: min(frame.width, frame.height) / 2).fill()
        if isGlass(shape) {
          for sublayer in shape.sublayers ?? [] { draw(sublayer, root: root, in: context) }
        } else {
          draw(shape, root: root, in: context)
        }
      }
      let label = UIColor.label.resolvedColor(with: traits)
      for layer in layers(in: root, where: isVibrant) {
        drawTinted(layer, root: root, color: label, scale: scale)
      }
    }
  }

  /// A layer only the render server draws.
  private static func isGlass(_ layer: CALayer) -> Bool {
    let name = NSStringFromClass(type(of: layer))
    return name.contains("SDF") || name.contains("Portal")
  }

  /// A glass shape: a SwiftUI glass control, or the platter behind a bar's buttons.
  private static func isShape(_ layer: CALayer) -> Bool {
    NSStringFromClass(type(of: layer)).hasSuffix(".SDFLayer")
      || layer.delegate.map { String(describing: type(of: $0)) } == "PlatterView"
  }

  /// Content colored by a filter that `render(in:)` does not apply.
  private static func isVibrant(_ layer: CALayer) -> Bool {
    let name = NSStringFromClass(type(of: layer))
    return layer.filters?.isEmpty == false && !name.contains("Backdrop")
      && !name.contains("Portal")
  }

  /// Every outermost glass layer, shown or not: `render(in:)` gives up on a hidden one too.
  private static func glassLayers(in layer: CALayer) -> [CALayer] {
    isGlass(layer) ? [layer] : (layer.sublayers ?? []).flatMap(glassLayers)
  }

  /// The outermost visible layers under `root` that `match`, skipping the glass's insides.
  private static func layers(in root: CALayer, where match: (CALayer) -> Bool) -> [CALayer] {
    guard !root.isHidden, root.opacity > 0 else { return [] }
    if match(root) { return [root] }
    if isGlass(root) { return [] }
    return (root.sublayers ?? []).flatMap { layers(in: $0, where: match) }
  }

  /// Draws `layer` where it sits in `root`, leaving out the glass inside it.
  private static func draw(_ layer: CALayer, root: CALayer, in context: CGContext) {
    guard !layer.isHidden, layer.opacity > 0, !isGlass(layer) else { return }
    guard layers(in: layer, where: isGlass).isEmpty else {
      for sublayer in layer.sublayers ?? [] { draw(sublayer, root: root, in: context) }
      return
    }
    context.saveGState()
    context.concatenate(transform(from: layer, to: root))
    layer.render(in: context)
    context.restoreGState()
  }

  /// Draws `layer`'s shape in one color over what the current context already holds.
  private static func drawTinted(_ layer: CALayer, root: CALayer, color: UIColor, scale: CGFloat) {
    let frame = layer.convert(layer.bounds, to: root)
    guard frame.width > 0, frame.height > 0 else { return }
    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    let shape = UIGraphicsImageRenderer(bounds: frame, format: format).image { inner in
      inner.cgContext.concatenate(transform(from: layer, to: root))
      layer.render(in: inner.cgContext)
    }
    let tinted = UIGraphicsImageRenderer(bounds: frame, format: format).image { inner in
      shape.draw(in: frame)
      color.setFill()
      inner.fill(frame, blendMode: .sourceIn)
    }
    tinted.draw(in: frame)
  }

  /// Maps `layer`'s coordinates to `root`'s.
  private static func transform(from layer: CALayer, to root: CALayer) -> CGAffineTransform {
    let origin = layer.convert(CGPoint.zero, to: root)
    let xAxis = layer.convert(CGPoint(x: 1, y: 0), to: root)
    let yAxis = layer.convert(CGPoint(x: 0, y: 1), to: root)
    return CGAffineTransform(
      a: xAxis.x - origin.x, b: xAxis.y - origin.y, c: yAxis.x - origin.x,
      d: yAxis.y - origin.y, tx: origin.x, ty: origin.y)
  }
}
