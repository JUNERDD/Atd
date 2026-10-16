import AICore
import AppKit
import UserNotifications

/// The app's own notification center, looked up on each call, and the categories its
/// notifications are posted under (``NotificationCategories``). Only an app bundle has one.
final class SystemNotificationCenter: UserNotificationCenter {
  private let categories: NotificationCategories

  /// - Parameter text: the String Catalog in the current language, which words the actions.
  init(text: @escaping () -> ShellText) {
    categories = NotificationCategories(text: text)
  }

  func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
    try await UNUserNotificationCenter.current().requestAuthorization(options: options)
  }

  /// Delivered at once (no trigger), once its category is registered. Posting with an identifier
  /// already delivered replaces that notification instead of adding one.
  func add(_ notification: SystemNotification) async throws {
    let content = UNMutableNotificationContent()
    content.title = notification.title
    content.body = notification.body
    content.sound = notification.sound ? .default : nil
    content.threadIdentifier = notification.threadIdentifier
    content.categoryIdentifier = notification.categoryIdentifier
    content.relevanceScore = notification.relevance
    var userInfo: [String: Any] = [:]
    if let taskId = notification.taskId { userInfo[ShellNotifier.taskIdKey] = taskId }
    if let request = notification.request {
      userInfo[ShellNotifier.requestIdKey] = request.id
      userInfo[ShellNotifier.revisionKey] = request.revision
    }
    if !notification.options.isEmpty { userInfo[ShellNotifier.optionsKey] = notification.options }
    content.userInfo = userInfo
    await categories.prepare(notification)
    try await UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: notification.identifier, content: content, trigger: nil))
  }

  /// Registers the categories worded in the current language; the shell registers again when the
  /// language changes.
  func registerCategories() { categories.register() }

  /// Removes every delivered notification that opens `taskId`, the task's own and its
  /// automation's alike: the person is looking at it now.
  func removeDelivered(taskId: String) async {
    await removeDelivered { $0[ShellNotifier.taskIdKey] as? String == taskId }
    // Its question, if the person already dismissed the notification, is moot as well.
    categories.forget(notifications: [SystemNotification.taskIdentifier(taskId)])
  }

  /// A `resolved` notice: the request was settled elsewhere, so the task's notification goes if
  /// it is still the one about that request (a newer state of the task stays).
  func withdraw(_ request: TaskNotice.Request, taskId: String) async {
    await removeDelivered {
      $0[ShellNotifier.taskIdKey] as? String == taskId
        && $0[ShellNotifier.requestIdKey] as? String == request.id
    }
    categories.forget(requestId: request.id)
  }

  private func removeDelivered(where matches: ([AnyHashable: Any]) -> Bool) async {
    let center = UNUserNotificationCenter.current()
    let identifiers = await center.deliveredNotifications().compactMap { delivered in
      let request = delivered.request
      return matches(request.content.userInfo) ? request.identifier : nil
    }
    guard !identifiers.isEmpty else { return }
    center.removeDeliveredNotifications(withIdentifiers: identifiers)
    categories.forget(notifications: identifiers)
  }

  func removeDelivered(identifier: String) {
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
    categories.forget(notifications: [identifier])
  }

  /// System Settings › Notifications at this app's own settings. The pane's documented anchor
  /// takes the bundle id; without one the pane opens at its list of apps.
  func openSystemSettings() {
    let pane = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
    let target = Bundle.main.bundleIdentifier.map { "\(pane)?id=\($0)" } ?? pane
    guard let url = URL(string: target) else { return }
    NSWorkspace.shared.open(url)
  }
}
