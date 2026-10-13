import AppKit
import SwiftUI

/// ``NativeMaterialView``'s material on macOS 15: an `NSVisualEffectView` holding its content as
/// `NSGlassEffectView` does (pinned to its edges with Auto Layout) and, on a borderless surface
/// (``outlined``), rounding itself to ``cornerRadius`` with a mask image and drawing a hairline
/// edge over its content. The mask is drawn at the view's size again whenever the size or the
/// radius changes; its cap insets keep the corners should AppKit stretch it before that. When the
/// view is its window's content view, the mask also shapes the window's shadow, which is then
/// recomputed after every change of shape.
final class MaterialEffectView: NSVisualEffectView {
  /// A rounded outline, a hairline edge and a mask; off for a titled window, which the system
  /// rounds.
  var outlined = false {
    didSet {
      hairline.isHidden = !outlined
      updateShape()
    }
  }

  var cornerRadius: CGFloat = 0 {
    didSet { if cornerRadius != oldValue { updateShape() } }
  }

  var contentView: NSView? {
    didSet {
      guard contentView !== oldValue else { return }
      oldValue?.removeFromSuperview()
      guard let contentView else { return }
      contentView.translatesAutoresizingMaskIntoConstraints = false
      // Under the hairline, which stays on top.
      addSubview(contentView, positioned: .below, relativeTo: hairline)
      NSLayoutConstraint.activate([
        contentView.leadingAnchor.constraint(equalTo: leadingAnchor),
        contentView.trailingAnchor.constraint(equalTo: trailingAnchor),
        contentView.topAnchor.constraint(equalTo: topAnchor),
        contentView.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }
  }

  private let hairline = MaterialHairlineView()

  init() {
    super.init(frame: .zero)
    hairline.frame = bounds
    hairline.autoresizingMask = [.width, .height]
    hairline.isHidden = true
    addSubview(hairline)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func setFrameSize(_ newSize: NSSize) {
    let changed = newSize != frame.size
    super.setFrameSize(newSize)
    if changed { updateShape() }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    invalidateWindowShadow()
  }

  private func updateShape() {
    hairline.cornerRadius = cornerRadius
    maskImage = outlined ? Self.mask(size: bounds.size, radius: cornerRadius) : nil
    invalidateWindowShadow()
  }

  /// The window's shadow follows the mask only of its content view.
  private func invalidateWindowShadow() {
    guard let window, window.contentView === self else { return }
    window.invalidateShadow()
  }

  /// The outline filled, at `size`; nil while the view has no area.
  private static func mask(size: NSSize, radius: CGFloat) -> NSImage? {
    guard size.width > 0, size.height > 0 else { return nil }
    let path = Self.outline(in: CGRect(origin: .zero, size: size), radius: radius)
    let image = NSImage(size: size, flipped: false) { _ in
      guard let context = NSGraphicsContext.current?.cgContext else { return false }
      context.addPath(path)
      context.setFillColor(NSColor.black.cgColor)
      context.fillPath()
      return true
    }
    // A continuous corner reaches about 1.53 radii along each edge.
    let cap = max(0, min(ceil(radius * 1.53), floor((min(size.width, size.height) - 1) / 2)))
    image.capInsets = NSEdgeInsets(top: cap, left: cap, bottom: cap, right: cap)
    return image
  }

  /// A borderless material's outline: a continuous rounded rectangle, as the surfaces' content
  /// layers round their corners (``GlassSurface/shape(_:content:cornerRadius:)``), its radius at
  /// most half the shorter side.
  static func outline(in rect: CGRect, radius: CGFloat) -> CGPath {
    let radius = max(0, min(radius, min(rect.width, rect.height) / 2))
    return Path(roundedRect: rect, cornerRadius: radius, style: .continuous).cgPath
  }
}

/// The hairline edge of a borderless material on macOS 15, where the glass's rim is missing: one
/// point of the separator color just inside the outline, over the material's content.
private final class MaterialHairlineView: NSView {
  var cornerRadius: CGFloat = 0 {
    didSet { needsDisplay = true }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    context.addPath(
      MaterialEffectView.outline(in: bounds.insetBy(dx: 0.5, dy: 0.5), radius: cornerRadius))
    context.setStrokeColor(NSColor.separatorColor.cgColor)
    context.setLineWidth(1)
    context.strokePath()
  }
}

/// A borderless material that draws its own shadow on macOS 15 (``NativeMaterialView``): the
/// effect view, filling the host, over a shadow of its outline. The host is the surface: its
/// frame, alpha and appearance are the surface's, so the shadow moves, fades and turns with the
/// material. The shadow reaches past the host into the transparent margin its window keeps around
/// the surface, so the host never clips its subviews.
final class MaterialShadowHost: NSView {
  private let effect: MaterialEffectView
  private let shadowView = MaterialShadowView()

  init(effect: MaterialEffectView) {
    self.effect = effect
    super.init(frame: .zero)
    clipsToBounds = false
    addSubview(shadowView)
    effect.frame = bounds
    effect.autoresizingMask = [.width, .height]
    addSubview(effect, positioned: .above, relativeTo: shadowView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    syncShadow()
  }

  /// Fits the shadow to the material's current size and corner radius.
  func syncShadow() {
    shadowView.fit(surface: bounds, cornerRadius: effect.cornerRadius)
  }
}

/// The shadow under a borderless material on macOS 15: a sibling under the effect view, never on
/// the effect view's own layer, where its mask would cut it off, and never over it, where it would
/// darken it. The material is translucent, and a shadow drawn from a path fills the shape's inside
/// too, which the material would show (blending within the window) or lay over the desktop's blur
/// (behind it); so a mask of the frame with the outline cut out (even-odd) keeps only the outside.
/// The view reaches past the surface by the blur radius plus the offset, which the windows'
/// transparent margins hold; were it the surface's own size, the mask would cut the whole shadow.
private final class MaterialShadowView: NSView {
  /// About the depth of the system's floating panels.
  private static let radius: CGFloat = 12
  /// Downward, in the host's y-up coordinates.
  private static let offset = CGSize(width: 0, height: -4)
  private static let opacity: Float = 0.3

  private let caster = CALayer()
  private let cutout = CAShapeLayer()

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    caster.shadowColor = NSColor.black.cgColor
    caster.shadowOpacity = Self.opacity
    caster.shadowRadius = Self.radius
    caster.shadowOffset = Self.offset
    cutout.fillRule = .evenOdd
    caster.mask = cutout
    layer?.addSublayer(caster)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Places the shadow around `surface` (the host's bounds) with its `cornerRadius`.
  func fit(surface: CGRect, cornerRadius: CGFloat) {
    let outset = Self.radius + max(abs(Self.offset.width), abs(Self.offset.height))
    frame = surface.insetBy(dx: -outset, dy: -outset)
    let shape = MaterialEffectView.outline(
      in: CGRect(x: outset, y: outset, width: surface.width, height: surface.height),
      radius: cornerRadius)
    let cut = CGMutablePath()
    cut.addRect(bounds)
    cut.addPath(shape)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    caster.frame = bounds
    caster.shadowPath = shape
    cutout.frame = bounds
    cutout.path = cut
    CATransaction.commit()
  }
}
