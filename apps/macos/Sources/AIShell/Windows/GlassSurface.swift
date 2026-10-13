import AppKit
import SwiftUI

/// The surface the shell's floating glass shares with the main panel: the selection toolbar, its
/// menus, the glass HUD, the capture toolbars, the mini panel and the command island. This is its
/// one owner: AppKit glass takes it through ``attach(_:content:)`` and ``shape(_:content:cornerRadius:)``,
/// SwiftUI glass through ``SwiftUI/View/glassSurface(in:animation:opacity:)``, so a new surface
/// cannot end up with the glass but without its fill and scheme. Like the panel's, it is dark
/// whatever the system appearance (the renderer is dark-only: `index.html` sets `class="dark"`),
/// and the glass carries the panel's base fill, `--ata-surface-panel` in
/// `packages/ui/src/styles.css`, opaque under Reduce Transparency, as that token turns.
///
/// Fixing the look matters because Liquid Glass otherwise adapts to the brightness behind it: a
/// newly made glass draws its first frame in its appearance's scheme and only switches after its
/// first luminance reading, 200–650 ms later, then animates for about 750 ms, so over a white
/// window every appearance of a dark surface went from black to white. With adaptation off
/// (``disableAdaptation(_:)``) the glass looks the same from its first frame over any backdrop;
/// the fill keeps its labels readable over a bright one.
///
/// On macOS 15 the material is `NSVisualEffectView` (``NativeMaterialView``), which does not adapt:
/// it takes the dark appearance directly. Its blur shows only through a thinner fill
/// (``fillOpacity``).
enum GlassSurface {
  /// The appearance every such surface pins, on the glass rather than its window.
  static let appearance = NSAppearance(named: .darkAqua)
  /// ``appearance`` for SwiftUI content.
  static let colorScheme = ColorScheme.dark

  /// `--ata-surface-panel`: `rgb(24 24 24 / 80%)` on Liquid Glass, opaque under Reduce
  /// Transparency.
  static func fill(reduceTransparency: Bool) -> NSColor {
    NSColor(
      srgbRed: 24 / 255, green: 24 / 255, blue: 24 / 255,
      alpha: reduceTransparency ? 1 : fillOpacity)
  }

  /// The fill's opacity over the material. Liquid Glass takes the token's 80%. Over macOS 15's
  /// `NSVisualEffectView` 80% would hide most of the blur, so it takes 50%, the first value: the
  /// macOS 15 verification build judges it and the Sequoia design variant confirms it (plan M2,
  /// M4).
  private static var fillOpacity: CGFloat {
    if #available(macOS 26, *) { 0.8 } else { 0.5 }
  }

  /// ``fill(reduceTransparency:)`` for SwiftUI.
  static func fillColor(reduceTransparency: Bool) -> Color {
    Color(nsColor: fill(reduceTransparency: reduceTransparency))
  }

  /// Pins `material` to ``appearance`` and, on Liquid Glass, stops it adapting to the backdrop's
  /// brightness. macOS 15's material has no such adaptation and takes the appearance alone.
  ///
  /// Adaptation has no public switch (`NSGlassEffectView` has `style` and `tintColor` only, and
  /// SwiftUI's `Glass` none at all); the private `_adaptiveAppearance` is 0 for automatic, 1 for
  /// off and 2 for on, and any other value traps in AppKit, so this writes only 1, and only while
  /// AppKit still answers the setter. An AppKit without it keeps adapting, as before. SwiftUI glass
  /// cannot be reached this way; its surfaces cover the adaptation with the fill instead, and pin
  /// ``colorScheme`` one container inside the glass content's root, since the glass writes its
  /// adapted scheme into that root's children (``GlassSurfaceFace``).
  static func disableAdaptation(_ material: NativeMaterialView) {
    guard #available(macOS 26, *), let glass = material.glass else {
      material.view.appearance = appearance
      return
    }
    glass.appearance = appearance
    guard glass.responds(to: NSSelectorFromString("set_adaptiveAppearance:")) else { return }
    glass.setValue(1, forKey: "_adaptiveAppearance")
  }

  /// Makes `content` the surface of `material`: the material's content, standing on the base
  /// fill, with the material pinned dark. The material does not clip its content, so `content`'s
  /// own layer carries the fill and its rounding (``shape(_:content:cornerRadius:)``); `content`
  /// must therefore leave its layer's background alone, which a scroll view does not (wrap one in
  /// a plain view).
  static func attach(_ material: NativeMaterialView, content: NSView) {
    content.wantsLayer = true
    material.contentView = content
    disableAdaptation(material)
  }

  /// Rounds `material` and its attached `content` alike and paints the fill as the system's
  /// Reduce Transparency now stands; call it again when either changes (a layout pass does).
  static func shape(_ material: NativeMaterialView, content: NSView, cornerRadius: CGFloat) {
    material.cornerRadius = cornerRadius
    content.layer?.cornerRadius = cornerRadius
    content.layer?.cornerCurve = .continuous
    content.layer?.backgroundColor =
      fill(reduceTransparency: ReduceTransparencyObserver.isReduced).cgColor
  }
}

extension View {
  /// This content on the shell's glass surface (``GlassSurfaceFace``), clipped to `outline` and
  /// on regular Liquid Glass of the same outline, which moves on `animation`, so the glass, its
  /// base and its content are one shape on every frame and only the outline changes from frame to
  /// frame. `opacity` fades the surface and the content under the glass; a glass container drops
  /// an opacity (as it drops a transform) set on the glass itself, so a piece's glass goes only
  /// by its outline.
  func glassSurface(in outline: some Shape, animation: Animation?, opacity: Double = 1)
    -> some View
  {
    modifier(GlassSurfaceFace())
      .animation(animation) { $0.opacity(opacity).clippedGlass(in: outline) }
  }

  /// This content clipped to `outline` and on regular Liquid Glass of the same outline, the two
  /// moving as one: `glassEffect(in:)` erases its shape, so a change to it reaches the animation
  /// as opaque data that moves as a whole, and the clip takes the shape erased the same way, so
  /// the clip, and the surface fill and content inside it, never part from the glass's rim. A
  /// clip given the shape itself would move per axis instead, and a fill inside it would slide
  /// off the glass. Set inside the piece's scoped animation; bare, it is glass without the
  /// surface, so pieces take it through ``glassSurface(in:animation:opacity:)``.
  func clippedGlass(in outline: some Shape) -> some View {
    let shape = AnyShape(outline)
    return clipShape(shape).glassEffect(.regular, in: shape)
  }
}

/// The shell's glass surface under SwiftUI content: the main panel's base fill, opaque under
/// Reduce Transparency, and the dark scheme for the content on it.
///
/// SwiftUI's glass adapts to the brightness behind it and has no switch to stop it: a new glass
/// draws its first frame in its scheme, turns light after its first luminance reading over a
/// bright window, and gives its content the light scheme too. The fill covers that glass, so a
/// piece reads as the panel whatever lies behind it. The content keeps the dark scheme because
/// the override sits one container inside the content's root: the glass writes its own scheme
/// into the root's children, past an override on the root itself or anywhere around the glass
/// (measured on macOS 26). Beneath the fill, the glass still adapts.
struct GlassSurfaceFace: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    ZStack { content.environment(\.colorScheme, GlassSurface.colorScheme) }
      .background {
        GlassSurface.fillColor(reduceTransparency: reduceTransparency)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
  }
}
