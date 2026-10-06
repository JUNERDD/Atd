import AICore
import AIRelay
import OSLog

/// Automations' notifications: posting the service's notices, and opening a run's task from one.
extension ShellController {
  private static let automationLog = Logger(subsystem: "com.junerdd.ai", category: "automations")

  /// The notice feed, posting through the system's notification center; nil outside an app
  /// bundle (tests, `swift run`), where there is none.
  static func makeAutomationNotices(services: ShellServices) -> AutomationNoticeFeed? {
    guard let notifier = AutomationNotifier.forMainBundle() else { return nil }
    return AutomationNoticeFeed(
      connect: { (try? await services.client()).map(AutomationNoticeFeed.Service.init(client:)) },
      post: { await notifier.post($0) },
      report: { failure in
        switch failure {
        case .read(let error):
          Self.automationLog.error(
            "Automation notices were not read: \(String(describing: error), privacy: .public)")
        case .acknowledge(let error):
          Self.automationLog.error(
            "Automation notices were not acknowledged: \(String(describing: error), privacy: .public)"
          )
        }
      })
  }

  /// Pulls the notices on every `automations` invalidation; the control stream's connection
  /// pulls the first time and after every reconnection.
  func startAutomationNotices() {
    control.onAutomationsInvalidated = { [weak self] in self?.automationNotices?.pull() }
  }

  /// A click on an automation's notification: the panel shows, then its page opens the run's task
  /// (`task.open`). The event waits for the page, so a click that launched the app opens the task
  /// once the panel's page is ready.
  func openNotifiedTask(_ taskId: String?) {
    showPanel()
    guard let taskId else { return }
    panelHost.send(.taskOpen(.init(taskId: taskId)))
  }
}
