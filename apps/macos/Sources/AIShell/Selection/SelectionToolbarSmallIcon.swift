import AICore
import AppKit
import QuartzCore

/// The small icon an admitted selection brings up first when the toolbar's `smallIcon` setting
/// asks for one (``SelectionToolbarIconMode``): a ``side``-point circle of the capsule's glass
/// (``AnnotationGlassBar`` round a single ``AnnotationToolbarButton``, without padding) showing the
/// toolbar's Ask glyph. ``SelectionToolbarPanel`` places it by the pointer rule, keeping room
/// for the toolbar (``SelectionToolbarPlacement/iconFrame(side:toolbarHeight:selection:pointer:displays:)``),
/// and shows it in the toolbar's own window, so whatever dismisses the toolbar dismisses the icon
/// too.
///
/// It asks to grow into the toolbar (``onExpand``) on a click in either mode, and in the `hover`
/// mode once the pointer has rested on it for ``rest``; leaving it sooner starts the wait over, so
/// a pointer passing over it never grows it. In the `click` mode a press that travels drags it
/// instead (``onDrag``), and the toolbar then grows out of it where it was dropped; the `hover`
/// mode's icon stays put, since resting on it grows it. Atd stays inactive while the icon shows, so its
/// tracking areas are unreliable: the toolbar's hover (``SelectionToolbarHover``) washes it and
/// sets the cursor, and reports the view under the pointer on every frame (``pointerAt(_:)``).
@MainActor
final class SelectionToolbarSmallIcon: NSObject {
  static let side = AnnotationToolbarButton.side
  /// The toolbar's height, its buttons' and its padding: the room the icon keeps for the toolbar
  /// it grows into.
  static let toolbarHeight = side + 2 * SelectionToolbarLayout.padding
  /// How long the pointer rests on the icon before the `hover` mode grows it.
  static let rest: CFTimeInterval = 0.15

  /// The icon wants to become the toolbar; called once.
  var onExpand: (() -> Void)?
  /// The icon is being dragged (the `click` mode's only), as the toolbar's capsule is.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)?

  /// The glass circle the panel places.
  let view: AnnotationGlassBar
  private let button: AnnotationToolbarButton
  private let growsOnRest: Bool
  /// When the pointer came onto the icon and has stayed on it since.
  private var restingSince: CFTimeInterval?
  private var expanded = false

  /// `mode` is the setting's, never `off`, which brings up the toolbar itself.
  init(mode: SelectionToolbarIconMode) {
    growsOnRest = mode == .hover
    let label = ShellStrings.shared.text(.selectionToolbarExpand)
    button = AnnotationToolbarButton(selection: nil, action: #selector(clicked))
    button.image = AnnotationIcons.glyph(SelectionToolbarIcons.ask, label: label)
    button.setAccessibilityLabel(label)
    button.toolTip = label
    button.followsPointer = false
    view = AnnotationGlassBar(groups: [[button]], blending: .behindWindow, padding: 0)
    super.init()
    button.target = self
    if mode == .click { button.onDrag = { [weak self] in self?.onDrag?($0) } }
  }

  /// The controls the hover follows.
  var controls: [any ToolbarHoverable] { [button] }

  /// What the icon shows now, its glyph and any hover wash, as an image: the toolbar it grows
  /// into lets it fade out as it grows (``SelectionToolbarMorph``).
  var face: NSImage? {
    guard let rep = button.bitmapImageRepForCachingDisplay(in: button.bounds) else { return nil }
    button.cacheDisplay(in: button.bounds, to: rep)
    let image = NSImage(size: button.bounds.size)
    image.addRepresentation(rep)
    return image
  }

  /// A hover frame: `view` is the followed view under the pointer.
  func pointerAt(_ view: NSView?) {
    guard growsOnRest, !expanded else { return }
    guard view === button else {
      restingSince = nil
      return
    }
    let now = CACurrentMediaTime()
    guard let since = restingSince else {
      restingSince = now
      return
    }
    if now - since >= Self.rest { expand() }
  }

  @objc private func clicked() { expand() }

  private func expand() {
    guard !expanded else { return }
    expanded = true
    onExpand?()
  }
}
