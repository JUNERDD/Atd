import AICore
import UserNotifications

/// The preferences and permission in the generated bridge types of `notifications.state` and
/// `notifications.set` (`NotificationStateSchema`).
extension NotificationPreferences {
  /// These preferences with the ones `changes` names replaced.
  func applying(_ changes: NotificationsSetParams) -> NotificationPreferences {
    var next = self
    if let finished = changes.finished {
      next.finished =
        switch finished {
        case .never: .never
        case .whenAway: .whenAway
        case .always: .always
        }
    }
    if let attention = changes.attention { next.attention = attention }
    if let sound = changes.sound { next.sound = sound }
    if let previews = changes.previews { next.previews = previews }
    return next
  }
}

extension NotificationsStateResult.Preferences {
  init(_ preferences: NotificationPreferences) {
    let finished: Finished =
      switch preferences.finished {
      case .never: .never
      case .whenAway: .whenAway
      case .always: .always
      }
    self.init(
      finished: finished, attention: preferences.attention, sound: preferences.sound,
      previews: preferences.previews)
  }
}

extension NotificationsStateResult.Permission {
  /// Provisional authorization delivers notifications, so it counts as allowed; a status this
  /// build does not know posts nothing (``ShellNotifier``), so it counts as denied.
  init(_ status: UNAuthorizationStatus) {
    switch status {
    case .notDetermined: self = .notDetermined
    case .authorized, .provisional: self = .allowed
    case .denied: self = .denied
    @unknown default: self = .denied
    }
  }
}

extension NotificationsSetResult {
  /// The same state, as `notifications.set` answers it.
  init(_ state: NotificationsStateResult) {
    let preferences = state.preferences
    let finished: Preferences.Finished =
      switch preferences.finished {
      case .never: .never
      case .whenAway: .whenAway
      case .always: .always
      }
    let permission: Permission =
      switch state.permission {
      case .notDetermined: .notDetermined
      case .denied: .denied
      case .allowed: .allowed
      }
    self.init(
      preferences: .init(
        finished: finished, attention: preferences.attention, sound: preferences.sound,
        previews: preferences.previews),
      permission: permission)
  }
}
