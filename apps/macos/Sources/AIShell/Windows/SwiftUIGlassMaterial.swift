import AppKit
import QuartzCore
import SwiftUI

/// SwiftUI glass's material on macOS 15: an `NSVisualEffectView` blurring the desktop behind the
/// window, configured as ``NativeMaterialView`` records for SwiftUI glass, pinned to
/// ``GlassSurface/appearance``, and framed and masked to `shape` so it never covers transparent
/// canvas regions (such as the island's bottom Dock inset) or stays attached under Reduce
/// Transparency. It lies under the surface's fill and content and takes no clicks or VoiceOver
/// focus, as the glass takes none. `shape` is a presentation snapshot supplied by the surface;
/// this bridge must not start an independent interpolation of the erased shape.
struct SwiftUIGlassMaterial: View {
  let shape: AnyShape
  let dark: Bool?
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var body: some View {
    SwiftUIGlassEffect(
      shape: shape,
      isDark: dark ?? GlassSurface.isDark,
      reduceTransparency: reduceTransparency)
  }
}

/// ``SwiftUIGlassMaterial``'s effect container, in the shape, scheme and transparency setting it is
/// given.
private struct SwiftUIGlassEffect: NSViewRepresentable {
  let shape: AnyShape
  let isDark: Bool
  let reduceTransparency: Bool

  func makeNSView(context: Context) -> SwiftUIGlassContainer {
    let container = SwiftUIGlassContainer(
      shape: shape, reduceTransparency: reduceTransparency)
    updateNSView(container, context: context)
    return container
  }

  func updateNSView(_ container: SwiftUIGlassContainer, context: Context) {
    container.update(shape: shape, isDark: isDark, reduceTransparency: reduceTransparency)
  }
}

/// Flipped container (`isFlipped == true`) matching SwiftUI's top-left coordinates so
/// `shape.path(in: bounds)` maps directly to ``PassiveEffectView``'s frame and `flipped: true`
/// `maskImage`. Re-applies on both `updateNSView` and `setFrameSize` so static and animated shapes
/// keep the effect tightly bounded and detached when empty or under Reduce Transparency.
private final class SwiftUIGlassContainer: NSView {
  private let effect = PassiveEffectView()
  private var shape: AnyShape
  private var reduceTransparency: Bool
  private var cachedMaskSize: NSSize?
  private var cachedMaskPath: CGPath?

  override var isFlipped: Bool { true }

  init(shape: AnyShape, reduceTransparency: Bool) {
    self.shape = shape
    self.reduceTransparency = reduceTransparency
    super.init(frame: .zero)
    NativeMaterialView.configure(effect, for: .swiftUIGlass)
    effect.setAccessibilityElement(false)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    let changed = newSize != frame.size
    super.setFrameSize(newSize)
    if changed { applyShape() }
  }

  func update(shape: AnyShape, isDark: Bool, reduceTransparency: Bool) {
    self.shape = shape
    self.reduceTransparency = reduceTransparency
    let appearanceName: NSAppearance.Name = isDark ? .darkAqua : .aqua
    if effect.appearance?.name != appearanceName {
      effect.appearance = NSAppearance(named: appearanceName)
    }
    applyShape()
  }

  private func applyShape() {
    // The surface has already interpolated this frame. Commit the native material's frame and
    // mask together, with no implicit Core Animation transition behind the SwiftUI clip.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }

    guard !reduceTransparency,
      bounds.width.isFinite, bounds.height.isFinite,
      bounds.width >= 1, bounds.height >= 1
    else {
      detachEffect()
      return
    }

    let path = shape.path(in: bounds)
    let rawRect = path.boundingRect
    guard !rawRect.isNull, !rawRect.isEmpty,
      rawRect.origin.x.isFinite, rawRect.origin.y.isFinite,
      rawRect.width.isFinite, rawRect.height.isFinite
    else {
      detachEffect()
      return
    }

    let rect = rawRect.intersection(bounds)
    guard !rect.isNull, !rect.isEmpty,
      rect.origin.x.isFinite, rect.origin.y.isFinite,
      rect.width.isFinite, rect.height.isFinite,
      rect.width >= 1, rect.height >= 1
    else {
      detachEffect()
      return
    }

    if effect.superview !== self {
      addSubview(effect)
    }
    if effect.frame != rect { effect.frame = rect }

    var translation = CGAffineTransform(translationX: -rect.minX, y: -rect.minY)
    let maskPath = path.cgPath.copy(using: &translation) ?? path.cgPath
    if effect.maskImage == nil || cachedMaskSize != rect.size || cachedMaskPath != maskPath {
      effect.maskImage = Self.makeMaskImage(size: rect.size, path: maskPath)
      cachedMaskSize = rect.size
      cachedMaskPath = maskPath
    }
  }

  private func detachEffect() {
    if effect.superview != nil {
      effect.removeFromSuperview()
    }
    effect.frame = .zero
    effect.maskImage = nil
    cachedMaskSize = nil
    cachedMaskPath = nil
  }

  private static func makeMaskImage(size: NSSize, path: CGPath) -> NSImage {
    NSImage(size: size, flipped: true) { _ in
      guard let context = NSGraphicsContext.current?.cgContext else { return false }
      context.addPath(path)
      context.setFillColor(NSColor.black.cgColor)
      context.fillPath()
      return true
    }
  }
}

/// An effect view that never takes the pointer: clicks go to the content over it, or to the
/// window, as they do through the glass.
private final class PassiveEffectView: NSVisualEffectView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
