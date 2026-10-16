import AICore
import Foundation
import OSLog
import UserNotifications

/// The part of the system's notification center the notifier uses. Only an app bundle has one
/// (`UNUserNotificationCenter.current()` traps anywhere else), so tests stand in for it.
protocol UserNotificationCenter {
  func authorizationStatus() async -> UNAuthorizationStatus
  func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
  func add(_ notification: SystemNotification) async throws
}

/// Posts automation and task notices as system notifications, worded from the String Catalog in
/// the shell's language at the moment each is posted and under the current preferences (sound,
/// previews). Whether a task notice is posted at all is the caller's (``ShellNotifications``).
///
/// Permission is asked while the person is there to answer (``askForPermission(again:)``); a
/// notice that arrives while nobody has decided yet asks as a fallback, at most once per launch
/// together with the other asks that are not the person's own request, so a prompt the person
/// closed does not come back with every notice. Without permission a notice is not shown, and
/// its feed acknowledges it all the same.
final class ShellNotifier {
  /// The `userInfo` keys of the task a notification opens (``NotificationResponder``), of the
  /// request its action answers, and of the full suggested answers its option actions send.
  nonisolated static let taskIdKey = "taskId"
  nonisolated static let requestIdKey = "requestId"
  nonisolated static let revisionKey = "revision"
  nonisolated static let optionsKey = "options"

  private let center: any UserNotificationCenter
  private let preferences: () -> NotificationPreferences
  private let text: () -> ShellText
  /// Asked this launch without the person's own request.
  private var asked = false
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "notifications")

  /// - Parameters:
  ///   - preferences: the person's current preferences.
  ///   - text: the String Catalog in the current language.
  init(
    center: any UserNotificationCenter, preferences: @escaping () -> NotificationPreferences,
    text: @escaping () -> ShellText
  ) {
    self.center = center
    self.preferences = preferences
    self.text = text
  }

  func post(_ notice: AutomationNotice) async {
    let current = preferences()
    await post(
      SystemNotification(notice, text: text(), previews: current.previews, sound: current.sound))
  }

  /// A `resolved` notice has no notification of its own (``ShellNotifications`` takes back what
  /// it settles), so it posts nothing.
  func post(_ notice: TaskNotice) async {
    let current = preferences()
    guard
      let notification = SystemNotification(
        notice, text: text(), previews: current.previews, sound: current.sound)
    else { return }
    await post(notification)
  }

  /// Shows the notification, asking for permission first when nobody has decided yet. Returns
  /// once it is shown or cannot be; failures only reach the log.
  private func post(_ notification: SystemNotification) async {
    guard await isAllowed() else {
      return Self.log.notice(
        "Notifications are not allowed; \(notification.identifier, privacy: .public) is not shown.")
    }
    do {
      try await center.add(notification)
    } catch {
      Self.log.error(
        "A notification was not shown: \(String(describing: error), privacy: .public)")
    }
  }

  func authorizationStatus() async -> UNAuthorizationStatus {
    await center.authorizationStatus()
  }

  /// Asks for permission when nobody has decided yet, and returns once the person answered.
  /// `again` asks even after an earlier ask this launch, for the person's own request (turning a
  /// notification on in Settings); otherwise this is the launch's one unprompted ask.
  @discardableResult
  func askForPermission(again: Bool) async -> Bool {
    guard await center.authorizationStatus() == .notDetermined, again || !asked else {
      return false
    }
    asked = true
    do {
      return try await center.requestAuthorization(options: [.alert, .sound])
    } catch {
      Self.log.error(
        "Notification permission failed: \(String(describing: error), privacy: .public)")
      return false
    }
  }

  private func isAllowed() async -> Bool {
    switch await center.authorizationStatus() {
    case .authorized, .provisional:
      true
    case .notDetermined:
      await askForPermission(again: false)
    case .denied:
      false
    @unknown default:
      false
    }
  }
}
