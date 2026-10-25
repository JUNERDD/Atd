import AICore
import AppKit
import OSLog

/// The application menu and the status item: what their items do (``AppMenus``), the status item
/// following the control stream, and the menus and window titles following the shell language.
extension ShellController {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "shell")

  var menuActions: AppMenuActions {
    let services = services
    return AppMenuActions(
      showPanel: { [weak self] in self?.showPanel() },
      hidePanel: { [weak self] in self?.hidePanel() },
      openSettings: { [weak self] in self?.openSettings(commandId: nil, section: nil) },
      openOnboarding: { [weak self] in self?.openOnboarding() },
      checkForUpdates: updater.isAvailable
        ? { [weak self] in self?.updater.checkForUpdates() } : nil,
      restartService: { try await services.restart() },
      showServiceLogs: { try services.revealLogs() },
      editCommand: { [weak self] command in self?.sendEditCommand(command) },
      developmentHint: { [weak self] in self?.menuStatus.developmentHint ?? false },
      selectionListening: { [weak self] in self?.toolbar.isListening },
      setSelectionListening: { [weak self] on in self?.toolbar.setListening(on) },
      miniPanelShown: { [weak self] in self?.miniPanel.isShown ?? false },
      setMiniPanelShown: { [weak self] shown in self?.miniPanel.setShown(shown) })
  }

  /// The status item follows the control stream: reachability, then the `status` counts.
  func refreshStatus() {
    let availability: ServiceAvailability =
      switch control.state {
      case .connecting: .connecting
      case .connected: .available
      case .reconnecting: .unavailable(development: false)
      case .disconnected:
        .unavailable(development: control.unavailable == .developmentServiceNotRunning)
      }
    menuStatus = MenuBarStatus(
      availability: availability, running: control.status?.running ?? 0,
      attention: control.status?.attention ?? 0)
    statusItem?.update(menuStatus)
    #if DEBUG
      Self.log.info(
        "menu bar \(self.menuStatus.state.rawValue, privacy: .public) running \(self.menuStatus.running) attention \(self.menuStatus.attention)"
      )
    #endif
  }

  func applyLanguage() {
    taskActivity.refresh()
    NSApp.mainMenu = AppMenus.mainMenu(menuActions)
    panel.setTitle(ShellStrings.shared.text(.windowPanelTitle))
    settings.setTitle(ShellStrings.shared.text(.windowSettingsTitle))
    onboarding.setTitle(ShellStrings.shared.text(.windowOnboardingTitle))
    // Notification actions are worded when registered: at launch and on every change.
    notifications?.registerCategories()
  }

  /// Undo and Redo go to the renderer page of the key window (the panel, settings, the welcome
  /// guide or a view's window), which runs them in its editor.
  func sendEditCommand(_ command: EditCommandEvent.Command) {
    let host: WebViewHost? =
      if panel.isKey {
        panelHost
      } else if settings.isKey {
        settings.host
      } else if onboarding.isKey {
        onboarding.host
      } else {
        viewWindows.keyHost
      }
    guard let host else { return sendUserAppEditCommand(command) }
    host.send(.editCommand(.init(command: command)), scope: .document)
  }
}
