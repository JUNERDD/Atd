import AppKit

/// The native material under one of the shell's surfaces: Liquid Glass (`NSGlassEffectView`) on
/// macOS 26 and `NSVisualEffectView` on macOS 15, behind one interface (content, corner radius,
/// size through ``view``'s frame) so the surfaces' owners never ask which system they run on.
/// On macOS 26 ``view`` is the glass itself, exactly as the surfaces placed it before. On macOS 15
/// the surface (``Surface``) decides everything the glass decided by itself:
///
/// | Surface            | Material                 | Blending      | State             | Shadow   |
/// | ------------------ | ------------------------ | ------------- | ----------------- | -------- |
/// | `window`           | `.underWindowBackground` | behind window | follows window    | window   |
/// | `onboarding`       | `.underWindowBackground` | behind window | active            | material |
/// | `permissionGuide`  | `.popover`               | behind window | active            | window   |
/// | `menu`             | `.menu`                  | behind window | active            | material |
/// | `capsule(mode)`    | `.hudWindow`             | the owner's   | active            | material |
/// | `swiftUIGlass`     | `.hudWindow`             | behind window | active            | none     |
///
/// The materials are the first choice, which the Sequoia design variants confirm (plan M4). A
/// titled window follows its window's active state, as the system's own windows do; every other
/// surface never becomes key, so it stays active (on macOS 26 ``ActiveGlassPanel`` does the
/// same for the glass). Blending is behind the window, the desktop, for everything floating over
/// other apps; the capture toolbars blend within their window instead, so they blur the frozen,
/// dimmed screenshot under them as the glass does on macOS 26 and never the live desktop.
///
/// Shape and shadow on macOS 15: the system rounds and shadows a titled window, and the material
/// draws its hairline along the window's corners (``MaterialEffectView/windowEdged``). A borderless
/// surface is rounded by a mask image of its outline (``MaterialEffectView``) and edged with a
/// hairline. The permission guide keeps its window's shadow, which only a mask on the window's
/// content view shapes, so its ``view`` is the effect view itself. The other borderless surfaces
/// draw no window shadow (their windows reach past them with a transparent margin), so their
/// ``view`` is a ``MaterialShadowHost``: the effect view over a shadow of the same outline, which
/// follows the surface's frame, corners and alpha.
final class NativeMaterialView {
  /// Where a material is used, which picks its macOS 15 configuration (the table above).
  enum Surface {
    /// A titled page window's whole content: the panel, Settings, a glass user app.
    case window
    /// The welcome guide's card, laid under part of its page.
    case onboarding
    /// The permission guide's borderless panel, which keeps its window's shadow.
    case permissionGuide
    /// A panel of the selection toolbar's menus.
    case menu
    /// A glass capsule (``AnnotationGlassBar``), blending as its owner says: within the capture
    /// overlay's window, behind the window everywhere else.
    case capsule(NSVisualEffectView.BlendingMode)
    /// SwiftUI glass (the mini panel and the command island), shaped by SwiftUI.
    case swiftUIGlass
  }

  /// What the surface's owner places: the glass on macOS 26; the effect view or its shadow host
  /// on macOS 15.
  let view: NSView
  /// The glass or the effect view, which holds the content.
  private let effect: NSView

  init(_ surface: Surface) {
    if #available(macOS 26, *) {
      effect = NSGlassEffectView()
      view = effect
    } else {
      let material = MaterialEffectView()
      Self.configure(material, for: surface)
      material.outlined = surface.isBorderless
      material.windowEdged = surface.isTitledWindow
      effect = material
      view = surface.drawsOwnShadow ? MaterialShadowHost(effect: material) : material
    }
  }

  /// The glass on macOS 26.
  @available(macOS 26, *)
  var glass: NSGlassEffectView? { effect as? NSGlassEffectView }

  /// The view on the material, pinned to its edges with Auto Layout, as `NSGlassEffectView`
  /// pins its content, so a content's width constraint sizes the surface (the permission guide).
  var contentView: NSView? {
    get {
      if #available(macOS 26, *), let glass { return glass.contentView }
      return (effect as? MaterialEffectView)?.contentView
    }
    set {
      if #available(macOS 26, *), let glass {
        glass.contentView = newValue
      } else {
        (effect as? MaterialEffectView)?.contentView = newValue
      }
    }
  }

  /// The outline's corner radius. A titled window's corners are the system's: there it only
  /// reaches the glass, as before.
  var cornerRadius: CGFloat {
    get {
      if #available(macOS 26, *), let glass { return glass.cornerRadius }
      return (effect as? MaterialEffectView)?.cornerRadius ?? 0
    }
    set {
      if #available(macOS 26, *), let glass {
        glass.cornerRadius = newValue
      } else {
        (effect as? MaterialEffectView)?.cornerRadius = newValue
        (view as? MaterialShadowHost)?.syncShadow()
      }
    }
  }

  /// Sets the macOS 15 material, blending and state `surface` takes (the table above).
  static func configure(_ effect: NSVisualEffectView, for surface: Surface) {
    effect.blendingMode = .behindWindow
    effect.state = .active
    switch surface {
    case .window:
      effect.material = .underWindowBackground
      effect.state = .followsWindowActiveState
    case .onboarding:
      effect.material = .underWindowBackground
    case .permissionGuide:
      effect.material = .popover
    case .menu:
      effect.material = .menu
    case .capsule(let blending):
      effect.material = .hudWindow
      effect.blendingMode = blending
    case .swiftUIGlass:
      effect.material = .hudWindow
    }
  }
}

extension NativeMaterialView.Surface {
  /// Without a title bar, so the material draws its own rounded outline.
  fileprivate var isBorderless: Bool {
    switch self {
    case .window, .swiftUIGlass: false
    case .onboarding, .permissionGuide, .menu, .capsule: true
    }
  }

  /// A titled page window, which the system rounds and shadows but whose edge the material draws.
  fileprivate var isTitledWindow: Bool {
    if case .window = self { return true }
    return false
  }

  /// Shadowed by the material rather than by the window (the table above).
  fileprivate var drawsOwnShadow: Bool {
    switch self {
    case .onboarding, .menu, .capsule: true
    case .window, .permissionGuide, .swiftUIGlass: false
    }
  }
}
