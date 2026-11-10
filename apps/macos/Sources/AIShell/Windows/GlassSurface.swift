import AppKit
import SwiftUI

/// The surface the shell's floating glass shares with the main panel: the selection toolbar, its
/// menus, the glass HUD, the capture toolbars, the mini panel and the command island. This is its
/// one owner: AppKit glass takes it through ``attach(_:content:)`` and ``shape(_:content:cornerRadius:)``,
/// SwiftUI glass through ``SwiftUI/View/glassSurface(in:animation:)``, so a new surface
/// cannot end up with the glass but without its fill and scheme. Like the panel's, it takes the
/// app's light or dark scheme (``AppAppearance``, the user's Theme setting or the system's), and
/// the glass carries the panel's base fill as the Panel background setting resolves it for that
/// scheme (``PanelBackground``, the page's `--ata-surface-panel`), opaque under Reduce
/// Transparency, as that token turns. The setting also chooses the Liquid Glass variant (regular or
/// clear) of these surfaces and of the page windows' glass (``adoptWindow(_:page:)``), and their
/// blur and refraction (``GlassTuner``, which every AppKit glass made here is given). When the
/// setting changes, the live AppKit glass takes it at once (``backgroundDidChange()``); SwiftUI
/// glass reads it through observation.
///
/// Telling the glass its scheme matters because Liquid Glass otherwise adapts to the brightness
/// behind it: a newly made glass draws its first frame in its appearance's scheme and only
/// switches after its first luminance reading, 200–650 ms later, then animates for about 750 ms,
/// so over a white window every appearance of a dark surface went from black to white. So the
/// glass is pinned to the app's scheme before its first frame and its adaptation is off
/// (``pin(_:to:)``): it looks the same from its first frame over any backdrop, and the fill keeps
/// its labels readable over a contrasting one. When the app's scheme changes, the live AppKit glass
/// is pinned again and refilled (``schemeDidChange()``); SwiftUI glass reads the scheme through
/// observation. ``pin(_:to:)`` is also the one way to pin AppKit glass whose scheme has another
/// owner: a glass user app's window, pinned to its page's scheme (``UserAppGlass``).
///
/// On macOS 15 the material is `NSVisualEffectView` (``NativeMaterialView``), which does not adapt:
/// it takes the pinned appearance directly. Its blur shows only through a thinner fill
/// (``materialOpacity(_:)``), and it has no variant, blur or refraction to set.
enum GlassSurface {
  /// Whether the surfaces take the dark scheme now: the app's (``AppAppearance/isDark``).
  static var isDark: Bool { AppAppearance.shared.isDark }
  /// The appearance every such surface pins now, on the glass rather than its window.
  static var appearance: NSAppearance? { NSAppearance(named: isDark ? .darkAqua : .aqua) }
  /// ``appearance`` for SwiftUI content; a view reading it is redrawn when it changes.
  static var colorScheme: ColorScheme { isDark ? .dark : .light }

  /// AppKit glass made by ``attach(_:content:)`` and still alive (``NativeMaterialView/view`` to
  /// its content), told again whenever the app's scheme or the panel background changes. Neither
  /// side is retained.
  private static let live = NSMapTable<NSView, NSView>.weakToWeakObjects()
  /// The page windows' glass (``adoptWindow(_:page:)``), told the variant again whenever the
  /// panel background changes. Not retained.
  private static let windows = NSHashTable<NSView>.weakObjects()
  /// Live AppKit glass that keeps the dark scheme whatever the app's is (``pinDark(_:)``). Not
  /// retained.
  private static let dark = NSHashTable<NSView>.weakObjects()

  /// The panel's base fill in the current scheme, as the Panel background setting resolves it
  /// (``PanelBackground/tone(dark:)``; the measured default is `rgb(24 24 24 / 60%)` dark and
  /// `rgb(255 255 255 / 56%)` light), at ``materialOpacity(_:)`` over the material and opaque
  /// under Reduce Transparency.
  static func fill(reduceTransparency: Bool, dark: Bool? = nil) -> NSColor {
    let tone = PanelBackground.shared.tone(dark: dark ?? isDark)
    return NSColor(
      srgbRed: CGFloat(tone.red) / 255, green: CGFloat(tone.green) / 255,
      blue: CGFloat(tone.blue) / 255,
      alpha: reduceTransparency ? 1 : materialOpacity(tone.alpha))
  }

  /// The fill's opacity over the material for the opacity the setting resolves, which is
  /// measured on Liquid Glass and taken there as it is. macOS 15's `NSVisualEffectView` was not
  /// measured: it keeps the relationship it had to Liquid Glass before the setting existed, 50%
  /// where Liquid Glass took 80% (the first value, which the macOS 15 verification build judges
  /// and the Sequoia design variant confirms, plan M2, M4). That ratio is carried over, not
  /// measured; above 80% the opacity rises linearly to full, so the Solid setting stays solid.
  private static func materialOpacity(_ opacity: Double) -> CGFloat {
    if #available(macOS 26, *) { return opacity }
    let carried = 0.5 / 0.8
    return opacity <= 0.8 ? opacity * carried : 0.5 + (opacity - 0.8) * (0.5 / 0.2)
  }

  /// ``fill(reduceTransparency:)`` for SwiftUI.
  static func fillColor(reduceTransparency: Bool, dark: Bool? = nil) -> Color {
    Color(nsColor: fill(reduceTransparency: reduceTransparency, dark: dark))
  }

  /// Pins `material` to `appearance` and, on Liquid Glass, stops it adapting to the backdrop's
  /// brightness. macOS 15's material has no such adaptation and takes the appearance alone. The
  /// appearance reaches the material's content too, as any view's does; content that must keep
  /// another scheme sets its own (``UserAppGlass``).
  ///
  /// Adaptation has no public switch (`NSGlassEffectView` has `style` and `tintColor` only, and
  /// SwiftUI's `Glass` none at all); the private `_adaptiveAppearance` is 0 for automatic, 1 for
  /// off and 2 for on, and any other value traps in AppKit, so this writes only 1, and only while
  /// AppKit still answers the setter. An AppKit without it keeps adapting, as before. SwiftUI glass
  /// cannot be reached this way; its surfaces cover the adaptation with the fill instead, and pin
  /// ``colorScheme`` one container inside the glass content's root, since the glass writes its
  /// adapted scheme into that root's children (``GlassSurfaceFace``).
  static func pin(_ material: NativeMaterialView, to appearance: NSAppearance?) {
    // On macOS 26 the view is the glass itself; on macOS 15 the effect view or its shadow host.
    material.view.appearance = appearance
    guard #available(macOS 26, *), let glass = material.glass,
      glass.responds(to: NSSelectorFromString("set_adaptiveAppearance:"))
    else { return }
    glass.setValue(1, forKey: "_adaptiveAppearance")
  }

  /// Makes `content` the surface of `material`: the material's content, standing on the base
  /// fill, with the material pinned to the app's scheme and in the panel background's variant,
  /// now and after every change of either (``schemeDidChange()``, ``backgroundDidChange()``), its
  /// blur and refraction tuned (``GlassTuner``). The material does not clip its content, so
  /// `content`'s own layer carries the fill and its rounding (``shape(_:content:cornerRadius:)``);
  /// `content` must therefore leave its layer's background alone, which a scroll view does not
  /// (wrap one in a plain view).
  static func attach(_ material: NativeMaterialView, content: NSView) {
    content.wantsLayer = true
    material.contentView = content
    pin(material, to: appearance)
    applyVariant(to: material.view)
    live.setObject(content, forKey: material.view)
    // The content may hold a page (the generative view windows'), whose glass stays the system's.
    GlassTuner.shared.track(material.view, skipping: content)
  }

  /// Makes `material` a page window's glass, the panel's or Settings', whose page paints the
  /// fill itself: the glass takes the panel background's variant now and after every change of
  /// it, and its blur and refraction are tuned (``GlassTuner``), without `page`, so the page's own
  /// in-page glass stays the system's.
  static func adoptWindow(_ material: NativeMaterialView, page: NSView) {
    applyVariant(to: material.view)
    windows.add(material.view)
    GlassTuner.shared.track(material.view, skipping: page)
  }

  /// Pins every live AppKit glass to the app's new scheme and repaints its fill. The appearance
  /// owner calls it on every change of the scheme, before the next frame, so a surface on screen
  /// switches at once rather than through the glass's own adaptation, which stays off.
  static func schemeDidChange() {
    for case let glass as NSView in live.keyEnumerator().allObjects {
      glass.appearance = dark.contains(glass) ? NSAppearance(named: .darkAqua) : appearance
    }
    repaint()
  }

  /// Gives every live AppKit glass the panel background's new fill and variant, the page
  /// windows' glass its variant, and the tuner its factors. The setting's owner calls it on every
  /// change (``PanelBackground/apply(_:)``).
  static func backgroundDidChange() {
    for glass in windows.allObjects { applyVariant(to: glass) }
    repaint()
    GlassTuner.shared.apply(PanelBackground.shared.tuning)
  }

  /// Paints every live AppKit glass's fill and variant as they stand now.
  private static func repaint() {
    for case let glass as NSView in live.keyEnumerator().allObjects {
      applyVariant(to: glass)
      live.object(forKey: glass)?.layer?.backgroundColor = surfaceFill(of: glass)
    }
  }

  /// Keeps `material`, attached by ``attach(_:content:)``, its fill and its content in the dark
  /// scheme whatever the app's is, now and after every change of the scheme or the panel
  /// background: AppKit glass that always stands over a dark backdrop, as the lightbox's editor
  /// bars do. Its SwiftUI counterpart is ``SwiftUI/View/glassSurface(in:animation:dark:)``.
  static func pinDark(_ material: NativeMaterialView) {
    dark.add(material.view)
    pin(material, to: NSAppearance(named: .darkAqua))
    live.object(forKey: material.view)?.layer?.backgroundColor = surfaceFill(of: material.view)
  }

  /// The base fill of live AppKit glass `glass`: in its pinned scheme, as Reduce Transparency
  /// stands now.
  private static func surfaceFill(of glass: NSView) -> CGColor {
    fill(
      reduceTransparency: ReduceTransparencyObserver.isReduced,
      dark: dark.contains(glass) ? true : nil
    ).cgColor
  }

  /// Sets the panel background's variant on `view` when it is Liquid Glass; macOS 15's material
  /// has none. A new style makes the glass rebuild its layers, so it is set only when it changed.
  private static func applyVariant(to view: NSView) {
    guard #available(macOS 26, *), let glass = view as? NSGlassEffectView else { return }
    let style: NSGlassEffectView.Style = PanelBackground.shared.clearGlass ? .clear : .regular
    if glass.style != style { glass.style = style }
  }

  /// Rounds `material` and its attached `content` alike and paints the fill as the system's
  /// Reduce Transparency now stands; call it again when either changes (a layout pass does).
  static func shape(_ material: NativeMaterialView, content: NSView, cornerRadius: CGFloat) {
    material.cornerRadius = cornerRadius
    content.layer?.cornerRadius = cornerRadius
    content.layer?.cornerCurve = .continuous
    content.layer?.backgroundColor = surfaceFill(of: material.view)
  }
}

extension View {
  /// This content on the shell's glass surface (``GlassSurfaceFace``), clipped to `outline` and
  /// on Liquid Glass of the same outline in the panel background's variant, which moves on
  /// `animation`, so the glass, its base and its content are one shape on every frame and only the
  /// outline changes from frame to frame. A glass container drops an opacity (as it drops a
  /// transform) set on the glass itself, so a piece's glass goes only by its outline, its fill and
  /// content with it.
  ///
  /// `dark` pins the surface to the dark scheme (or the light one) whatever the app's is, for a
  /// surface that is always dark: the lightbox's bars over its dark scrim.
  func glassSurface(in outline: some Shape, animation: Animation?, dark: Bool? = nil)
    -> some View
  {
    // Read here, in the body of the view the surface belongs to, which observation then redraws
    // when the variant changes.
    let clear = PanelBackground.shared.clearGlass
    return modifier(GlassSurfaceFace(dark: dark))
      .animation(animation) { $0.clippedGlass(in: outline, clear: clear, dark: dark) }
  }

  /// This content clipped to `outline` and on Liquid Glass of the same outline, regular or
  /// `clear`, the two moving as one: `glassEffect(in:)` erases its shape, so a change to it
  /// reaches the animation as opaque data that moves as a whole, and the clip takes the shape
  /// erased the same way, so the clip, and the surface fill and content inside it, never part
  /// from the glass's rim. A clip given the shape itself would move per axis instead, and a fill
  /// inside it would slide off the glass. Set inside the piece's scoped animation; bare, it is
  /// glass without the surface, so pieces take it through ``glassSurface(in:animation:)``.
  ///
  /// macOS 15 has no Liquid Glass. There the material is the desktop's blur under the window
  /// (``SwiftUIGlassMaterial``), clipped by the same erased shape as the content, so it follows
  /// the outline frame by frame as the glass does; neighbouring shapes never merge. SwiftUI's own
  /// `Material` cannot stand in: it blurs only the window's content, and these windows are
  /// transparent. Whether a behind-window material follows a clip that changes on every frame is
  /// what the macOS 15 verification build checks (plan M2); should it not, the agreed fallback is
  /// a fill of the surface tokens inside the window with no desktop blur, keeping the morph and
  /// the interaction.
  @ViewBuilder func clippedGlass(in outline: some Shape, clear: Bool, dark: Bool? = nil)
    -> some View
  {
    let shape = AnyShape(outline)
    if #available(macOS 26, *) {
      clipShape(shape).glassEffect(clear ? .clear : .regular, in: shape)
    } else {
      clipShape(shape).background { SwiftUIGlassMaterial(dark: dark).clipShape(shape) }
    }
  }
}

/// SwiftUI glass's material on macOS 15: an `NSVisualEffectView` blurring the desktop behind the
/// window, configured as ``NativeMaterialView`` records for SwiftUI glass and pinned to
/// ``GlassSurface/appearance``, again whenever the app's scheme changes (this body reads it). It
/// lies under the surface's fill and content and takes no clicks or VoiceOver focus, as the glass
/// takes none.
private struct SwiftUIGlassMaterial: View {
  var dark: Bool?
  var body: some View { SwiftUIGlassEffect(isDark: dark ?? GlassSurface.isDark) }
}

/// ``SwiftUIGlassMaterial``'s effect view, in the scheme it is given.
private struct SwiftUIGlassEffect: NSViewRepresentable {
  let isDark: Bool

  func makeNSView(context: Context) -> NSVisualEffectView {
    let effect = PassiveEffectView()
    NativeMaterialView.configure(effect, for: .swiftUIGlass)
    effect.setAccessibilityElement(false)
    updateNSView(effect, context: context)
    return effect
  }

  func updateNSView(_ effect: NSVisualEffectView, context: Context) {
    effect.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)
  }
}

/// An effect view that never takes the pointer: clicks go to the content over it, or to the
/// window, as they do through the glass.
private final class PassiveEffectView: NSVisualEffectView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The shell's glass surface under SwiftUI content: the main panel's base fill, opaque under
/// Reduce Transparency, and the app's scheme for the content on it, both following its changes.
///
/// SwiftUI's glass adapts to the brightness behind it and has no switch to stop it: a new glass
/// draws its first frame in its scheme, turns light after its first luminance reading over a
/// bright window, and gives its content the light scheme too. The fill covers that glass, so a
/// piece reads as the panel whatever lies behind it. The content keeps the app's scheme because
/// the override sits one container inside the content's root: the glass writes its own scheme
/// into the root's children, past an override on the root itself or anywhere around the glass
/// (measured on macOS 26). Beneath the fill, the glass still adapts.
struct GlassSurfaceFace: ViewModifier {
  /// The scheme the surface keeps whatever the app's is; nil follows the app's.
  var dark: Bool?
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    let scheme = dark.map { $0 ? ColorScheme.dark : .light } ?? GlassSurface.colorScheme
    ZStack { content.environment(\.colorScheme, scheme) }
      .background {
        GlassSurface.fillColor(reduceTransparency: reduceTransparency, dark: dark)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
  }
}
