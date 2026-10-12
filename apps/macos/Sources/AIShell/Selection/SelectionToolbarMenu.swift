import AICore
import AppKit

/// One panel of the selection toolbar's menus: the More menu, a command's options menu, or a
/// submenu beside either (``ToolbarOptionsCascade`` decides what each shows and where). It
/// replaces the system menu More used to pop up, which, opened from an app that is not active,
/// highlighted an item only once the window server got round to delivering its tracking events.
/// Its rows (``ToolbarOptionsRow``) keep the toolbar's labelled button metrics, stretched to the
/// longest row, and the toolbar's ``SelectionToolbarHover`` washes them on every display frame
/// like the capsule's buttons.
///
/// Its window never takes the keyboard or activates Atd, sits above the toolbar at the same
/// level and joins every Space like it (``SelectionToolbarPanel/makeWindow()``), and reaches
/// ``SelectionToolbarPanel/inset`` past the glass on every side, so the glass's shadow is never
/// cut off; that margin is transparent. A list taller than the room scrolls; a scroll over it
/// scrolls the list, one over another app still hides the toolbar.
///
/// VoiceOver reads it as a menu with the given name, with a menu item per row.
final class SelectionToolbarMenu: NSObject {
  /// A press landed in the transparent margin, off the glass, at this point on screen: the
  /// margin can lie over the toolbar or another panel of the cascade.
  var onPressOutside: ((NSPoint) -> Void)?

  private let window = SelectionToolbarPanel.makeWindow()
  private let hover: SelectionToolbarHover
  private var rows: [any ToolbarHoverable] = []
  /// The glass on screen while the panel shows.
  private(set) var surface: NSRect?

  /// `hover` is the toolbar's: one owner for the wash and the cursor across every window.
  init(hover: SelectionToolbarHover) {
    self.hover = hover
    super.init()
  }

  var isOpen: Bool { window.isVisible }

  /// Shows `items` (rows and separators, each `rowWidth` wide) top down on a glass panel at
  /// `placed` (screen points, the glass's frame), which scrolls when it is shorter than
  /// `content`, the whole list's size; `label` names the menu for VoiceOver.
  func open(_ items: [NSView], content: WindowSize, at placed: ScreenRect, label: String) {
    close()
    rows = items.compactMap { $0 as? any ToolbarHoverable }
    let inset = SelectionToolbarPanel.inset
    let frame = NSRect(placed).insetBy(dx: -inset, dy: -inset)
    let container = MenuContainer(frame: NSRect(origin: .zero, size: frame.size))
    container.wantsLayer = true
    container.onPressOutside = { [weak self] point in self?.onPressOutside?(point) }
    let glass = makeGlass(items: items, scrolls: placed.height < content.height, label: label)
    glass.frame = container.bounds.insetBy(dx: inset, dy: inset)
    container.surface = glass
    container.addSubview(glass)
    window.contentView = container
    window.setFrame(frame, display: true)
    window.orderFrontRegardless()
    surface = NSRect(placed)
    hover.add(rows)
  }

  /// Takes the panel off the screen and its rows out of hover; nothing to do when it is closed.
  func close() {
    if !rows.isEmpty { hover.remove(rows) }
    rows = []
    surface = nil
    guard window.contentView != nil else { return }
    window.orderOut(nil)
    window.contentView = nil
  }

  /// The glass panel around the rows' list, which scrolls when the panel is shorter than the
  /// list. The list is clipped to the glass's own corners (the glass does not clip its content),
  /// so a row scrolled half out of sight never shows past them, and stands on the toolbar's fixed
  /// dark surface (``GlassSurface``), the fill drawn in the same rounded clip.
  private func makeGlass(items: [NSView], scrolls: Bool, label: String) -> NSGlassEffectView {
    let layout = SelectionToolbarMenuLayout.self
    let list = MenuList(views: items)
    list.orientation = .vertical
    list.alignment = .leading
    list.spacing = layout.rowGap
    list.edgeInsets = NSEdgeInsets(
      top: layout.padding, left: layout.padding, bottom: layout.padding, right: layout.padding)
    list.frame = NSRect(origin: .zero, size: list.fittingSize)
    let scroll = NSScrollView()
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    scroll.automaticallyAdjustsContentInsets = false
    scroll.horizontalScrollElasticity = .none
    scroll.verticalScrollElasticity = .none
    scroll.scrollerStyle = .overlay
    scroll.hasVerticalScroller = scrolls
    // The scroller runs along the straight part of the edge, clear of the rounded corners.
    scroll.scrollerInsets = NSEdgeInsets(
      top: layout.cornerRadius, left: 0, bottom: layout.cornerRadius, right: 0)
    scroll.documentView = list
    scroll.autoresizingMask = [.width, .height]
    // The rows are the menu's items, not a scroll area's.
    scroll.setAccessibilityElement(false)
    // The surface is a plain view around the scroll view, not the scroll view itself: a scroll
    // view clears its own layer's background whenever it draws, which dropped the fill and left
    // the menus lighter than the capsule. It clips to its bounds, rounded by the surface like
    // the glass.
    let surface = NSView()
    surface.clipsToBounds = true
    surface.addSubview(scroll)
    let glass = NSGlassEffectView()
    GlassSurface.attach(glass, content: surface)
    GlassSurface.shape(glass, content: surface, cornerRadius: layout.cornerRadius)
    glass.setAccessibilityElement(true)
    glass.setAccessibilityRole(.menu)
    glass.setAccessibilityLabel(label)
    return glass
  }
}

/// The rows top down from the list's origin, so a list taller than the panel opens at its first
/// row.
private final class MenuList: NSStackView {
  override var isFlipped: Bool { true }
}

/// The menu window's content. The glass's shadow in the transparent margin can keep a press
/// there from passing to the window below, where the toolbar's buttons or another panel's rows
/// sit under the margin, so a press off the glass goes to the owner with where it landed.
private final class MenuContainer: NSView {
  var onPressOutside: ((NSPoint) -> Void)?
  weak var surface: NSView?

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    guard let surface, !surface.frame.contains(convert(event.locationInWindow, from: nil))
    else { return }
    onPressOutside?(NSEvent.mouseLocation)
  }
}
