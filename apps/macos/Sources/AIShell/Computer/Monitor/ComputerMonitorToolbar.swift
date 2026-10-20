import AICore
import AppKit

/// The monitor window's toolbar: symbol-only items, each with a label, a tooltip and an
/// accessibility description. Focus mode leads with All Sources and, when there is more than one
/// source, a grouped Previous / Next pair; Keep on Top trails in every mode. An item that does
/// not apply is hidden rather than disabled, so the bar never shows empty glass.
final class ComputerMonitorToolbar: NSObject, NSToolbarDelegate {
  /// What the toolbar offers: grid mode (also with no sources), or focus mode with or without
  /// other sources to step to.
  enum Mode: Equatable {
    case grid
    case focus(multiple: Bool)
  }

  struct Actions {
    var allSources: () -> Void
    var previous: () -> Void
    var next: () -> Void
    var keepOnTop: () -> Void
  }

  let toolbar = NSToolbar(identifier: "ComputerMonitor")
  private let actions: Actions
  private var items: [NSToolbarItem.Identifier: NSToolbarItem] = [:]
  private var mode = Mode.grid
  private var keepOnTop = false

  init(actions: Actions) {
    self.actions = actions
    super.init()
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    toolbar.allowsUserCustomization = false
  }

  func update(mode: Mode, keepOnTop: Bool) {
    self.mode = mode
    self.keepOnTop = keepOnTop
    apply()
  }

  /// Relabels the items. The Previous / Next pair is built from its labels and images, so it is
  /// built again.
  func localize() {
    if let index = toolbar.items.firstIndex(where: { $0.itemIdentifier == .navigation }) {
      toolbar.removeItem(at: index)
      toolbar.insertItem(withItemIdentifier: .navigation, at: index)
    }
    apply()
  }

  /// Labels, symbols and visibility for the current mode and language.
  private func apply() {
    let strings = ShellStrings.shared
    if let item = items[.allSources] {
      Self.configure(
        item, label: strings.text(.computerMonitorAllSources), symbol: "square.grid.2x2")
      item.isHidden = mode == .grid
    }
    items[.navigation]?.isHidden = mode != .focus(multiple: true)
    if let item = items[.keepOnTop] {
      let symbol = keepOnTop ? "pin.fill" : "pin"
      Self.configure(item, label: strings.text(.computerMonitorKeepOnTop), symbol: symbol)
    }
  }

  private static func configure(_ item: NSToolbarItem, label: String, symbol: String) {
    item.label = label
    item.paletteLabel = label
    item.toolTip = label
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
  }

  // MARK: NSToolbarDelegate

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [.allSources, .navigation, .flexibleSpace, .keepOnTop]
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  func toolbar(
    _ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
    willBeInsertedIntoToolbar flag: Bool
  ) -> NSToolbarItem? {
    let item: NSToolbarItem
    switch identifier {
    case .allSources:
      item = NSToolbarItem(itemIdentifier: identifier)
      item.action = #selector(allSourcesPressed)
    case .navigation:
      let strings = ShellStrings.shared
      let labels = [
        strings.text(.computerMonitorPreviousSource), strings.text(.computerMonitorNextSource),
      ]
      let images = zip(["chevron.backward", "chevron.forward"], labels).compactMap {
        NSImage(systemSymbolName: $0, accessibilityDescription: $1)
      }
      let group = NSToolbarItemGroup(
        itemIdentifier: identifier, images: images, selectionMode: .momentary, labels: labels,
        target: self, action: #selector(navigationPressed(_:)))
      for (subitem, label) in zip(group.subitems, labels) { subitem.toolTip = label }
      item = group
    case .keepOnTop:
      item = NSToolbarItem(itemIdentifier: identifier)
      item.action = #selector(keepOnTopPressed)
    default:
      return nil
    }
    item.target = self
    item.isBordered = true
    items[identifier] = item
    apply()
    return item
  }

  @objc private func allSourcesPressed() { actions.allSources() }
  @objc private func keepOnTopPressed() { actions.keepOnTop() }

  @objc private func navigationPressed(_ sender: NSToolbarItemGroup) {
    if sender.selectedIndex == 0 {
      actions.previous()
    } else {
      actions.next()
    }
  }
}

extension NSToolbarItem.Identifier {
  fileprivate static let allSources = Self("computerMonitor.allSources")
  fileprivate static let navigation = Self("computerMonitor.navigation")
  fileprivate static let keepOnTop = Self("computerMonitor.keepOnTop")
}
