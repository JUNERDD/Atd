import AICore
import AppKit
import QuartzCore

/// An entry of one of the selection toolbar's menu panels: a row, or the hairline between rows.
struct ToolbarMenuItem {
  /// The row's look; nil for a separator.
  var content: ToolbarOptionsRow.Content?
  /// Builds the side submenu the row opens on hover or click.
  var submenu: (() -> [ToolbarMenuItem])?
  /// What a click on the row does; a row with a submenu and no action opens the submenu at once.
  var action: (() -> Void)?

  static let separator = ToolbarMenuItem(content: nil)
}

/// The selection toolbar's menus as one cascade (contract: selection toolbar, mouse path): a
/// first panel below (or above) the capsule, opened from More or a split command's chevron, and
/// side submenus from its rows, each a ``SelectionToolbarMenu`` of ``ToolbarOptionsRow``s. What
/// the panels show comes from builders (``ToolbarOptionsContent``), which re-run on ``refresh()``
/// so rows show new values in place while every panel stays where it is.
///
/// Submenus follow the pointer through the toolbar's hover frames (``pointerAt(_:)``), timed by
/// ``ToolbarOptionsSubmenuIntent`` per panel: resting on a row with a submenu opens it, moving to
/// another row closes it after a grace period unless the pointer reaches the submenu; a click on
/// such a row opens it at once. A row whose submenu is open keeps its wash. The cascade is mouse
/// only and closes as a whole: whatever hides the toolbar or closes its menu closes every panel.
final class ToolbarOptionsCascade: NSObject {
  /// The cascade closed entirely, by any path.
  var onClose: (() -> Void)?

  private let hover: SelectionToolbarHover
  private var levels: [Level] = []
  /// One panel per depth, kept while the cascade is open: a submenu that swaps as the pointer
  /// crosses rows reuses its depth's window rather than making a new one each time.
  private var panels: [SelectionToolbarMenu] = []
  /// The control the first panel opened from (a chevron or More), while it is open.
  private(set) weak var opener: NSView?

  /// One open panel: what built it, its items and their rows in order (nil for a separator), and
  /// the timing of its submenu.
  private final class Level {
    let menu: SelectionToolbarMenu
    let build: () -> [ToolbarMenuItem]
    var items: [ToolbarMenuItem]
    let rows: [ToolbarOptionsRow?]
    var intent = ToolbarOptionsSubmenuIntent()

    init(
      menu: SelectionToolbarMenu, build: @escaping () -> [ToolbarMenuItem],
      items: [ToolbarMenuItem], rows: [ToolbarOptionsRow?]
    ) {
      self.menu = menu
      self.build = build
      self.items = items
      self.rows = rows
    }
  }

  init(hover: SelectionToolbarHover) {
    self.hover = hover
    super.init()
  }

  var isOpen: Bool { !levels.isEmpty }

  /// Opens the first panel with `build`'s items beside `anchor` (screen points: the opener's
  /// column through the capsule, see ``SelectionToolbarMenuPlacement``), named `label`, closing
  /// any cascade already open. Nothing opens without items or displays.
  func open(
    from opener: NSView, anchor: NSRect, label: String,
    build: @escaping () -> [ToolbarMenuItem]
  ) {
    close()
    present(build, label: label) { size in
      SelectionToolbarMenuPlacement.frame(
        size: size, anchor: ScreenRect(anchor), displays: Self.displays())
    }
    if isOpen { self.opener = opener }
  }

  /// Closes every panel; nothing to do when none is open.
  func close() {
    guard isOpen else { return }
    truncate(to: 0)
    panels = []
    opener = nil
    onClose?()
  }

  /// Re-reads every open panel's items after a value changed, updating its rows in place.
  func refresh() {
    for level in levels {
      let items = level.build()
      guard items.count == level.items.count else { continue }
      level.items = items
      for (row, item) in zip(level.rows, items) {
        if let row, let content = item.content { row.content = content }
      }
    }
  }

  /// Closes the deepest submenu (a value was picked in it) and shows the new values in the rest.
  func closeDeepest() {
    guard levels.count > 1 else { return close() }
    truncate(to: levels.count - 1)
    refresh()
  }

  // MARK: Pointer

  /// A hover frame: `view` is the followed view under the pointer. Each panel learns whether the
  /// pointer is on one of its rows, in its submenu, or neither, and opens or closes its submenu
  /// when its timing says so; a change ends the pass, since it rebuilt everything deeper.
  func pointerAt(_ view: NSView?) {
    guard isOpen else { return }
    let point = NSEvent.mouseLocation
    let now = CACurrentMediaTime()
    // Deeper panels lie above shallower ones where they overlap.
    let deepest = levels.lastIndex { $0.menu.surface?.contains(point) == true }
    for (index, level) in levels.enumerated() {
      let pointer: ToolbarOptionsSubmenuIntent.Pointer
      if let deepest, deepest > index {
        pointer = .inSubmenu
      } else if deepest == index, let view,
        let row = level.rows.firstIndex(where: { $0 === view })
      {
        pointer = .row(row, opens: level.items[row].submenu != nil)
      } else {
        pointer = .away
      }
      switch level.intent.update(pointer, at: now) {
      case .open(let row): return openSubmenu(of: index, row: row)
      case .close: return truncate(to: index + 1)
      case nil: continue
      }
    }
  }

  // MARK: Panels

  /// Opens a panel of `build`'s items where `place` puts a list of their size.
  private func present(
    _ build: @escaping () -> [ToolbarMenuItem], label: String,
    place: (WindowSize) -> ScreenRect?
  ) {
    let items = build()
    guard let width = items.compactMap(\.content).map(ToolbarOptionsRow.width).max() else {
      return
    }
    let rows = items.map { item in
      item.content.map { content in
        let row = ToolbarOptionsRow(content, width: width, action: #selector(rowClicked))
        row.target = self
        return row
      }
    }
    let views = rows.map { $0 ?? ToolbarOptionsSeparator(width: width) }
    let rowCount = rows.count(where: { $0 != nil })
    let size = SelectionToolbarMenuLayout.size(
      rowWidth: width, rowCount: rowCount, separatorCount: rows.count - rowCount)
    guard let placed = place(size) else { return }
    let menu = panel(at: levels.count)
    menu.open(views, content: size, at: placed, label: label)
    levels.append(Level(menu: menu, build: build, items: items, rows: rows))
  }

  /// Opens row `row`'s submenu of panel `index` beside it, closing anything deeper.
  private func openSubmenu(of index: Int, row: Int) {
    truncate(to: index + 1)
    let level = levels[index]
    guard let build = level.items[row].submenu, let view = level.rows[row],
      let window = view.window, let parent = level.menu.surface
    else { return }
    let frame = window.convertToScreen(view.convert(view.bounds, to: nil))
    present(build, label: level.items[row].content?.title ?? "") { size in
      SelectionToolbarSubmenuPlacement.frame(
        size: size, row: ScreenRect(frame), parent: ScreenRect(parent),
        displays: Self.displays())
    }
    guard levels.count > index + 1 else { return }
    view.isActive = true
    level.intent.opened(row)
  }

  /// The panel for depth `depth`, made the first time the cascade reaches that depth.
  private func panel(at depth: Int) -> SelectionToolbarMenu {
    if panels.indices.contains(depth) { return panels[depth] }
    let menu = SelectionToolbarMenu(hover: hover)
    menu.onPressOutside = { [weak self] point in self?.pressed(at: point) }
    panels.append(menu)
    return menu
  }

  /// Closes the panels past the first `count`; the panel left deepest forgets its submenu.
  private func truncate(to count: Int) {
    guard levels.count > count else { return }
    while levels.count > count { levels.removeLast().menu.close() }
    guard let parent = levels.last else { return }
    for row in parent.rows { row?.isActive = false }
    parent.intent.closed()
  }

  @objc private func rowClicked(_ sender: ToolbarOptionsRow) {
    guard let index = levels.firstIndex(where: { $0.rows.contains { $0 === sender } }),
      let row = levels[index].rows.firstIndex(where: { $0 === sender })
    else { return }
    let item = levels[index].items[row]
    if let action = item.action { return action() }
    if item.submenu != nil, levels[index].intent.openRow != row {
      openSubmenu(of: index, row: row)
    }
  }

  /// A press in a panel's transparent margin: on another panel's row it is a click there (the
  /// margin overlapped it); anywhere else it closes the cascade, as a press outside a menu does.
  private func pressed(at point: NSPoint) {
    for level in levels.reversed() {
      guard let surface = level.menu.surface, surface.contains(point) else { continue }
      let row = level.rows.compactMap(\.self).first { row in
        guard let window = row.window else { return false }
        let visible = row.visibleRect.intersection(row.bounds)
        return window.convertToScreen(row.convert(visible, to: nil)).contains(point)
      }
      if let row { rowClicked(row) }
      return
    }
    close()
  }

  private static func displays() -> [SelectionToolbarPlacement.Display] {
    NSScreen.screens.map {
      .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame))
    }
  }
}
