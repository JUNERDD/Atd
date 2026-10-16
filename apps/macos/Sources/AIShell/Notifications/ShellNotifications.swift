import AICore
import AIRelay
import Foundation
import OSLog

/// The shell's half of notifications: the service decides what happened and queues notices; this
/// pulls them (one feed per kind of notice), decides whether the person is looking at the task and
/// what the preferences allow, posts through ``ShellNotifier``, and answers a task's request from
/// a notification's action. It also owns the preferences (``NotificationPreferences``) and the
/// task the panel's page shows (`task.shown`), whose delivered notifications it clears.
final class ShellNotifications {
  private let services: ShellServices
  private let defaults: UserDefaults
  private let center = SystemNotificationCenter { ShellStrings.shared.catalog }
  /// Whether the panel is shown and key, the window half of "looking at the task".
  private let panelFocused: () -> Bool
  private(set) var preferences: NotificationPreferences
  /// The task the panel's page last reported showing; nil while it shows none.
  private var shownTaskId: String?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "notifications")

  /// Owned for the app's lifetime by the controller, so the notifier never outlives it.
  private lazy var notifier = ShellNotifier(
    center: center, preferences: { [unowned self] in preferences },
    text: { ShellStrings.shared.catalog })

  lazy var automations = AutomationNoticeFeed(
    connect: { [services] in
      (try? await services.client()).map(AutomationNoticeFeed.Service.init(client:))
    },
    post: { [notifier] in await notifier.post($0) },
    report: { Self.log(failure: $0, of: "Automation") })

  lazy var tasks = TaskNoticeFeed(
    connect: { [services] in
      (try? await services.client()).map(TaskNoticeFeed.Service.init(client:))
    },
    post: { [weak self] in await self?.post($0) },
    report: { Self.log(failure: $0, of: "Task") })

  /// Nil outside an app bundle (tests, `swift run`), where there is no notification center.
  init?(services: ShellServices, defaults: UserDefaults, panelFocused: @escaping () -> Bool) {
    guard Bundle.main.bundleIdentifier != nil else { return nil }
    self.services = services
    self.defaults = defaults
    self.panelFocused = panelFocused
    preferences = NotificationPreferences(defaults: defaults)
  }

  /// Both feeds, for notices made while the shell was away from the service.
  func pull() {
    automations.pull()
    tasks.pull()
  }

  /// The categories and their actions in the current language; at launch and on every change.
  func registerCategories() {
    center.registerCategories()
  }

  /// Posts a task notice unless the preferences leave it out or the person is looking at the
  /// task: the panel shown, key, and showing that task. A `resolved` notice instead takes back
  /// the notification of the request it settles, whatever the preferences. The feed acknowledges
  /// every notice either way.
  private func post(_ notice: TaskNotice) async {
    if notice.kind == .resolved, let request = notice.request {
      return await center.withdraw(request, taskId: notice.taskId)
    }
    let looking = panelFocused() && shownTaskId == notice.taskId
    guard preferences.posts(notice.kind, looking: looking) else { return }
    await notifier.post(notice)
  }

  /// `task.shown` from the panel's page: that task is in front of the person now, so its
  /// delivered notifications go.
  func taskShown(_ taskId: String?) {
    shownTaskId = taskId
    clearShownTask()
  }

  /// The panel came back showing the task it showed before.
  func panelShown() { clearShownTask() }

  private func clearShownTask() {
    guard let taskId = shownTaskId else { return }
    Task { [center] in await center.removeDelivered(taskId: taskId) }
  }

  /// The launch's one unprompted ask, while the person is there and has tasks under way.
  func askWhileTasksActive() {
    Task { [notifier] in await notifier.askForPermission(again: false) }
  }

  /// `notifications.state`.
  func state() async -> NotificationsStateResult {
    NotificationsStateResult(
      preferences: .init(preferences), permission: .init(await notifier.authorizationStatus()))
  }

  /// `notifications.set`: applies the given preferences and, when that turns a notification on
  /// while nobody has decided on the permission, asks now and waits for the answer.
  func apply(_ changes: NotificationsSetParams) async -> NotificationsSetResult {
    let previous = preferences
    preferences = previous.applying(changes)
    preferences.save(to: defaults)
    if previous.turnsOn(preferences) { await notifier.askForPermission(again: true) }
    let state = await state()
    return NotificationsSetResult(state)
  }

  func openSystemSettings() { center.openSystemSettings() }

  /// Sends a notification's Reply, option or Decline to the request, then removes the
  /// notification. Throws when the service is unavailable or refuses the answer (the request is
  /// gone or stale).
  func answer(_ reply: ConfirmReply, identifier: String) async throws {
    try await services.client().replyToConfirm(reply)
    center.removeDelivered(identifier: identifier)
  }

  private static func log<Notice>(failure: NoticeFeed<Notice>.Failure, of kind: String) {
    switch failure {
    case .read(let error):
      log.error("\(kind) notices were not read: \(String(describing: error), privacy: .public)")
    case .acknowledge(let error):
      log.error(
        "\(kind) notices were not acknowledged: \(String(describing: error), privacy: .public)")
    }
  }
}
