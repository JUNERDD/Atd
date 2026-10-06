import AICore
import AppKit

/// What the application menu and the status item's menu do (``AppMenus``).
extension ShellController {
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
}
