import AICore

/// Opening and closing the settings window, for the bridge (`settings.open`, `settings.close`)
/// and for the shell's own menus and notifications.
extension ShellController {
  /// A new settings window opens `commandId`'s editor or `section`; an open one keeps its page,
  /// which the page's own window message steers.
  func openSettings(commandId: String?, section: String?) {
    // The settings window would activate and order in against the capture overlays.
    guard !screenshots.isCapturing else { return }
    settings.onOpenChange = { [weak self] in self?.settingsOpenChanged() }
    settings.open(
      fragment: SettingsWindowController.fragment(commandId: commandId, section: section),
      title: ShellStrings.shared.text(.windowSettingsTitle))
  }

  func closeSettings() { settings.close() }

  private func settingsOpenChanged() {
    presence.applyDockVisibility(windowOpen: keepsDockIcon, restoreFocus: settings.isOpen)
  }
}
