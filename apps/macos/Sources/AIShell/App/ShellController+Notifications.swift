import AICore
import AIRelay
import OSLog

/// Notifications: pulling the service's automation and task notices, the presence they depend
/// on, the permission asks, and what a click or an action on a notification does.
extension ShellController {
  private static let notificationLog = Logger(
    subsystem: "com.junerdd.ai", category: "notifications")

  /// "Looking" needs the panel shown and key; the page reports the task it shows.
  static func makeNotifications(
    services: ShellServices, defaults: UserDefaults, panel: PanelWindowController
  ) -> ShellNotifications? {
    ShellNotifications(services: services, defaults: defaults) { panel.isVisible && panel.isKey }
  }

  /// Pulls each kind of notice on its invalidation; the control stream's connection pulls both
  /// the first time and after every reconnection. The categories register with the language
  /// (``applyLanguage()``).
  func startNotifications() {
    control.onAutomationsInvalidated = { [weak self] in self?.notifications?.automations.pull() }
    control.onTaskNoticesInvalidated = { [weak self] in self?.notifications?.tasks.pull() }
  }

  /// The panel's visibility: shown again, it clears the notifications of the task it shows;
  /// hidden while tasks run or wait, it is the moment to ask for permission once, while the
  /// person is still there and before anything needs to notify. A capture or a system panel
  /// hiding it is not the person's doing.
  func notificationsPanelVisibility(_ visible: Bool) {
    guard let notifications else { return }
    if visible { return notifications.panelShown() }
    guard menuStatus.running > 0 || menuStatus.attention > 0, !screenshots.isCapturing,
      !systemPanels.isOpen
    else { return }
    notifications.askWhileTasksActive()
  }

  /// What the person did with a notification (``NotificationResponder``).
  func respondToNotification(_ response: NotificationResponse) {
    switch response {
    case .open(let taskId):
      openNotifiedTask(taskId)
    case .answer(let reply, let taskId, let identifier):
      Task { [weak self] in
        do {
          try await self?.notifications?.answer(reply, identifier: identifier)
        } catch {
          Self.notificationLog.error(
            "A notification's answer was not taken: \(String(describing: error), privacy: .public)"
          )
          self?.openNotifiedTask(taskId)
        }
      }
    }
  }

  /// A click on a notification: the panel shows, then its page opens the task (`task.open`).
  /// The event waits for the page, so a click that launched the app opens the task once the
  /// panel's page is ready. An automation run that started no task (memory consolidation) has
  /// none to open, so the click opens Settings at the Automations section, where its run is
  /// listed; an already open settings window just comes forward.
  func openNotifiedTask(_ taskId: String?) {
    guard let taskId else { return openSettings(commandId: nil, section: "automations") }
    showPanel()
    panelHost.send(.taskOpen(.init(taskId: taskId)))
  }
}
