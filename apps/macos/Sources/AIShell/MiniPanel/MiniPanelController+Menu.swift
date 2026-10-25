import AICore
import AppKit

/// The Mini Panel context menu keeps settings and activity visibility in one lifecycle.
extension MiniPanelController {
  // MARK: Context menu

  /// Move to the other edge, Open on Click (checked while it does), Hide Mini Panel, then
  /// Settings… (Settings › General).
  func makeMenu() -> NSMenu {
    let strings = ShellStrings.shared
    let menu = NSMenu()
    let other = placement.edge.opposite
    let move: ShellStringKey = other == .left ? .miniPanelMoveLeft : .miniPanelMoveRight
    menu.addItem(ActionMenuItem(strings.text(move)) { [weak self] in self?.move(to: other) })
    menu.addItem(
      ActionMenuItem(
        strings.text(.miniPanelOpenOnClick), isOn: { [weak self] in self?.openOn == .click }
      ) { [weak self] in
        guard let self else { return }
        setOpenOn(openOn == .click ? .hover : .click)
      })
    menu.addItem(
      ActionMenuItem(strings.text(.miniPanelHide)) { [weak self] in self?.setShown(false) })
    menu.addItem(.separator())
    menu.addItem(
      ActionMenuItem(strings.text(.menuSettings)) { [weak self] in self?.actions.openSettings() })
    return menu
  }

  func menuChanged(_ open: Bool) {
    menuOpen = open
    if open { dropLabel() }
    activityPhaseChanged()
    endPress()
    pointer.wake()
  }
}
