import AICore
import Foundation

/// The user's Screenshot settings in the shell: whether confirming a screenshot capture with
/// the toolbar ✓ button (or Return / double-click) also copies it to the clipboard, and whether
/// confirming a live long screenshot opens the result card or copies directly to the clipboard.
/// The panel page pushes them (`screenshotPreferences.set`) after settings load and on every
/// change; they are kept in user defaults, so a launch reads the last pushed values before that
/// first push, defaulting to `copyOnConfirm = true` and `longScreenshotConfirmAction = .card`.
final class ScreenshotPreferences {
  static let shared = ScreenshotPreferences()

  private(set) var copyOnConfirm: Bool
  private(set) var longScreenshotConfirmAction:
    ScreenshotPreferencesSetPost.LongScreenshotConfirmAction

  private let defaults: UserDefaults

  private static let copyOnConfirmKey = "screenshotPreferences.copyOnConfirm"
  private static let longScreenshotConfirmActionKey =
    "screenshotPreferences.longScreenshotConfirmAction"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    copyOnConfirm = defaults.object(forKey: Self.copyOnConfirmKey) as? Bool ?? true
    longScreenshotConfirmAction =
      defaults.string(forKey: Self.longScreenshotConfirmActionKey).flatMap(
        ScreenshotPreferencesSetPost.LongScreenshotConfirmAction.init(rawValue:)) ?? .card
  }

  /// Whether Return or Done in a live long screenshot copies directly instead of opening the card.
  var copiesLongScreenshotOnConfirm: Bool {
    longScreenshotConfirmAction == .copy
  }

  func apply(_ post: ScreenshotPreferencesSetPost) {
    defaults.set(post.copyOnConfirm, forKey: Self.copyOnConfirmKey)
    defaults.set(
      post.longScreenshotConfirmAction.rawValue, forKey: Self.longScreenshotConfirmActionKey)
    copyOnConfirm = post.copyOnConfirm
    longScreenshotConfirmAction = post.longScreenshotConfirmAction
  }
}
