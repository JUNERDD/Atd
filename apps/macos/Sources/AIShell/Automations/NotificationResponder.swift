import Foundation
import UserNotifications

/// The notification center's delegate. Atd's notifications show as banners even while it is the
/// active app, and a click on one (its default action) opens the task it names.
///
/// The center calls the delegate on a queue of its own, so both callbacks are nonisolated: they
/// take what they need from the system's objects and hand the task id to the main actor. A click
/// that launches the app arrives before the shell can show the panel, so clicks are held until
/// ``deliver(to:)``.
final class NotificationResponder: NSObject, UNUserNotificationCenterDelegate {
  private var open: ((_ taskId: String?) -> Void)?
  private var held: [String?] = []

  /// Clicks wait for ``deliver(to:)``: the shell shows the panel for them, not its launch reveal.
  var hasHeldClicks: Bool { !held.isEmpty }

  /// Becomes the delegate; the app does this before it finishes launching, as the center
  /// requires for a click that launched it. Outside an app bundle there is no center.
  func install() {
    guard Bundle.main.bundleIdentifier != nil else { return }
    UNUserNotificationCenter.current().delegate = self
  }

  /// Clicks go to `open` from now on, starting with those held since launch.
  func deliver(to open: @escaping (_ taskId: String?) -> Void) {
    self.open = open
    let clicks = held
    held = []
    for taskId in clicks { open(taskId) }
  }

  private func clicked(taskId: String?) {
    guard let open else { return held.append(taskId) }
    open(taskId)
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
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
      let userInfo = response.notification.request.content.userInfo
      let taskId = userInfo[AutomationNotifier.taskIdKey] as? String
      DispatchQueue.main.async { MainActor.assumeIsolated { self.clicked(taskId: taskId) } }
    }
    completionHandler()
  }
}
