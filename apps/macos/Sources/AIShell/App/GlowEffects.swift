import Foundation

/// The user's Glow effects setting in the shell: whether its surfaces show their working light
/// (``IslandWorkingGlow``, behind the command HUD, the mini panel and task activity) and shimmer
/// running text (``ShimmerLabel``). The panel page pushes it (`glowEffects.set`) after settings
/// load and on every change; it is kept in the user defaults, so a launch shows the last choice
/// before that first push, and reads as on until the user ever turns it off. Each change posts
/// ``didChange``, which the live glows and labels follow.
final class GlowEffects {
  static let shared = GlowEffects()
  static let didChange = Notification.Name("GlowEffects.didChange")

  private(set) var enabled: Bool
  private let defaults: UserDefaults

  /// The defaults key of the last pushed setting; absent until the first push.
  private static let key = "glowEffects"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    enabled = defaults.object(forKey: Self.key) as? Bool ?? true
  }

  func apply(_ enabled: Bool) {
    defaults.set(enabled, forKey: Self.key)
    guard enabled != self.enabled else { return }
    self.enabled = enabled
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }
}
