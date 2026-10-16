import Foundation

/// The person's notification preferences (`NotificationPreferencesSchema`), kept in this Mac's
/// user defaults like the Dock setting and never synced to the service. Settings › General
/// changes them through `notifications.set`.
public struct NotificationPreferences: Equatable, Sendable {
  /// When a finished or failed task notifies.
  public enum Finished: String, Equatable, Sendable {
    case never
    /// Unless the person is looking at that task (``NotificationPreferences/posts(_:looking:)``).
    case whenAway
    case always
  }

  public var finished: Finished
  /// Whether a question or an approval nobody answered notifies while the person is away.
  public var attention: Bool
  /// Whether notifications, automations' included, play the default sound.
  public var sound: Bool
  /// Whether notifications, automations' included, show runtime text.
  public var previews: Bool

  public init(finished: Finished, attention: Bool, sound: Bool, previews: Bool) {
    self.finished = finished
    self.attention = attention
    self.sound = sound
    self.previews = previews
  }

  /// What a Mac that never changed them uses: finished tasks only while away, questions and
  /// approvals on, sound on, previews on. A question has to be read to be answered from its
  /// notification, and macOS already keeps previews off the lock screen (System Settings ›
  /// Notifications › Show previews), so turning them off is the person's extra opt-out.
  public static let defaults = NotificationPreferences(
    finished: .whenAway, attention: true, sound: true, previews: true)

  /// The stored preferences; each one never stored, or stored in an unknown form, is its default.
  public init(defaults store: UserDefaults) {
    let fallback = Self.defaults
    finished =
      store.string(forKey: Key.finished).flatMap(Finished.init(rawValue:)) ?? fallback.finished
    attention = store.object(forKey: Key.attention) as? Bool ?? fallback.attention
    sound = store.object(forKey: Key.sound) as? Bool ?? fallback.sound
    previews = store.object(forKey: Key.previews) as? Bool ?? fallback.previews
  }

  public func save(to store: UserDefaults) {
    store.set(finished.rawValue, forKey: Key.finished)
    store.set(attention, forKey: Key.attention)
    store.set(sound, forKey: Key.sound)
    store.set(previews, forKey: Key.previews)
  }

  /// Whether a task notice of `kind` becomes a notification, given whether the person is looking
  /// at its task (the panel shown, key, and showing that task). A `resolved` notice only takes
  /// back what was shown, so it never does.
  public func posts(_ kind: TaskNotice.Kind, looking: Bool) -> Bool {
    switch kind {
    case .resolved:
      false
    case .needsInput, .needsConfirmation:
      attention && !looking
    case .completed, .failed:
      switch finished {
      case .never: false
      case .whenAway: !looking
      case .always: true
      }
    }
  }

  /// Whether `next` turns on a notification these preferences leave off, which is when the shell
  /// asks for permission while the person is there to answer.
  public func turnsOn(_ next: NotificationPreferences) -> Bool {
    (finished == .never && next.finished != .never) || (!attention && next.attention)
  }

  private enum Key {
    static let finished = "notifications.finished"
    static let attention = "notifications.attention"
    static let sound = "notifications.sound"
    static let previews = "notifications.previews"
  }
}
