import AICore
import Foundation
import UserNotifications

/// What the person did with one of Atd's notifications.
nonisolated enum NotificationResponse: Sendable {
  /// A click (the default action): open the task it names, or the place its notice points to.
  case open(taskId: String?)
  /// Reply, a suggested answer, or Decline on a task's question or approval: answer the request
  /// from here. The
  /// notification's identifier goes away once the answer is taken; the task opens instead when
  /// the request is gone or the answer is refused.
  case answer(ConfirmReply, taskId: String, identifier: String)
}

/// The notification center's delegate. Atd's notifications show as banners even while it is the
/// active app; a click on one opens the task it names, and a task's Reply, suggested answer or
/// Decline answers its request.
///
/// The center calls the delegate on a queue of its own, so both callbacks are nonisolated: they
/// take what they need from the system's objects and hand it to the main actor. A response that
/// launches the app arrives before the shell is ready, so responses are held until
/// ``deliver(to:)``.
final class NotificationResponder: NSObject, UNUserNotificationCenterDelegate {
  private var handle: ((NotificationResponse) -> Void)?
  private var held: [NotificationResponse] = []

  /// Responses wait for ``deliver(to:)``: the shell acts on them, not on its launch reveal.
  var hasHeldResponses: Bool { !held.isEmpty }

  /// Becomes the delegate; the app does this before it finishes launching, as the center
  /// requires for a response that launched it. Outside an app bundle there is no center.
  func install() {
    guard Bundle.main.bundleIdentifier != nil else { return }
    UNUserNotificationCenter.current().delegate = self
  }

  /// Responses go to `handle` from now on, starting with those held since launch.
  func deliver(to handle: @escaping (NotificationResponse) -> Void) {
    self.handle = handle
    let responses = held
    held = []
    for response in responses { handle(response) }
  }

  private func received(_ response: NotificationResponse) {
    guard let handle else { return held.append(response) }
    handle(response)
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let action = Self.response(to: response) {
      DispatchQueue.main.async { MainActor.assumeIsolated { self.received(action) } }
    }
    completionHandler()
  }

  /// The response the shell acts on, or nil for one it ignores (a dismissal). An answer whose
  /// request the notification does not name, an empty reply, or an option the notification does
  /// not carry opens the task instead.
  private nonisolated static func response(to response: UNNotificationResponse)
    -> NotificationResponse?
  {
    let request = response.notification.request
    let userInfo = request.content.userInfo
    let taskId = userInfo[ShellNotifier.taskIdKey] as? String
    let action = response.actionIdentifier
    let answer: ConfirmReply.Answer
    switch action {
    case UNNotificationDefaultActionIdentifier:
      return .open(taskId: taskId)
    case NotificationCategories.replyAction:
      let text = (response as? UNTextInputNotificationResponse)?.userText
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard let text, !text.isEmpty else { return .open(taskId: taskId) }
      answer = .text(text)
    case NotificationCategories.denyAction:
      answer = .declined
    case _ where action.hasPrefix(NotificationCategories.optionActionPrefix):
      // The button shows a clipped title; the answer is the option in full.
      let index = Int(action.dropFirst(NotificationCategories.optionActionPrefix.count))
      guard let index, let options = userInfo[ShellNotifier.optionsKey] as? [String],
        options.indices.contains(index)
      else { return .open(taskId: taskId) }
      answer = .text(options[index])
    default:
      return nil
    }
    guard let taskId, let requestId = userInfo[ShellNotifier.requestIdKey] as? String,
      let revision = userInfo[ShellNotifier.revisionKey] as? Int
    else { return .open(taskId: taskId) }
    return .answer(
      ConfirmReply(requestId: requestId, revision: revision, answer: answer), taskId: taskId,
      identifier: request.identifier)
  }
}
