import AICore
import Foundation
import OSLog
import UserNotifications

/// The part of the system's notification center the notifier uses. Only an app bundle has one
/// (`UNUserNotificationCenter.current()` traps anywhere else), so tests stand in for it.
protocol UserNotificationCenter {
  func authorizationStatus() async -> UNAuthorizationStatus
  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
  func add(_ notification: AutomationNotification) async throws
}

/// Posts automation notices as system notifications, worded from the String Catalog in the
/// shell's language at the moment each is posted. Permission is asked on the first notice, not at
/// launch, and at most once per launch, so a prompt the person closed does not come back with
/// every notice. Without permission a notice is not shown, and ``AutomationNoticeFeed``
/// acknowledges it all the same.
final class AutomationNotifier {
  /// The `userInfo` key of the task a notification opens (``NotificationResponder``).
  nonisolated static let taskIdKey = "taskId"

  private let center: any UserNotificationCenter
  private let text: () -> ShellText
  private var asked = false
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "automations")

  /// - Parameter text: the String Catalog in the current language.
  init(center: any UserNotificationCenter, text: @escaping () -> ShellText) {
    self.center = center
    self.text = text
  }

  /// The app's notifier, or nil outside an app bundle (tests, `swift run`).
  static func forMainBundle() -> AutomationNotifier? {
    guard Bundle.main.bundleIdentifier != nil else { return nil }
    return AutomationNotifier(center: SystemNotificationCenter()) { ShellStrings.shared.catalog }
  }

  /// Shows the notice, asking for permission first when nobody has decided yet. Returns once it
  /// is shown or cannot be; failures only reach the log.
  func post(_ notice: AutomationNotice) async {
    guard await isAllowed() else {
      return Self.log.notice(
        "Notifications are not allowed; automation notice \(notice.id, privacy: .public) is not shown."
      )
    }
    do {
      try await center.add(AutomationNotification(notice, text: text()))
    } catch {
      Self.log.error(
        "An automation notice was not shown: \(String(describing: error), privacy: .public)")
    }
  }

  private func isAllowed() async -> Bool {
    switch await center.authorizationStatus() {
    case .authorized, .provisional:
      return true
    case .notDetermined:
      guard !asked else { return false }
      asked = true
      do {
        return try await center.requestAuthorization(options: [.alert, .sound])
      } catch {
        Self.log.error(
          "Notification permission failed: \(String(describing: error), privacy: .public)")
        return false
      }
    case .denied:
      return false
    @unknown default:
      return false
    }
  }
}

/// The app's own notification center, looked up on each call.
struct SystemNotificationCenter: UserNotificationCenter {
  func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
    try await UNUserNotificationCenter.current().requestAuthorization(options: options)
  }

  /// Delivered at once (no trigger), with the default sound. The request takes the notice's id,
  /// so posting a notice again replaces its notification instead of adding one.
  func add(_ notification: AutomationNotification) async throws {
    let content = UNMutableNotificationContent()
    content.title = notification.title
    content.body = notification.body
    content.sound = .default
    content.threadIdentifier = notification.threadIdentifier
    if let taskId = notification.taskId {
      content.userInfo = [AutomationNotifier.taskIdKey: taskId]
    }
    try await UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: notification.identifier, content: content, trigger: nil))
  }
}
