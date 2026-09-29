import AICore
import Foundation

/// Native copy from the App target's String Catalog, in the language the page pushes (the
/// service's `language` setting) rather than the system's (grill decision Q21). Until the first
/// push it follows the system like the renderer's first run. A change applies at once: owners
/// of long-lived surfaces (menus, the status item, window titles) rebuild on
/// ``didChange``; alerts and panels read the current language when they open.
@MainActor
final class ShellStrings {
  static let shared = ShellStrings()
  static let didChange = Notification.Name("com.junerdd.ai.shellStringsDidChange")

  private(set) var language: ShellLanguage
  private var table: Bundle

  private init() {
    language = .system(preferredLanguages: Locale.preferredLanguages)
    table = Self.bundle(for: language)
  }

  /// Applies the pushed `en` / `zh-CN`; false for a value the shell does not ship.
  @discardableResult
  func apply(appLanguage: String) -> Bool {
    guard let next = ShellLanguage(appLanguage: appLanguage) else { return false }
    guard next != language else { return true }
    language = next
    table = Self.bundle(for: next)
    NotificationCenter.default.post(name: Self.didChange, object: nil)
    return true
  }

  func text(_ key: ShellStringKey) -> String {
    table.localizedString(forKey: key.rawValue, value: nil, table: nil)
  }

  /// A catalog string with one `%lld`.
  func text(_ key: ShellStringKey, count: Int) -> String {
    String(format: text(key), locale: Locale(identifier: language.rawValue), count)
  }

  /// A catalog string with one `%@`.
  func text(_ key: ShellStringKey, _ argument: String) -> String {
    String(format: text(key), locale: Locale(identifier: language.rawValue), argument)
  }

  /// The compiled `<language>.lproj` of the app bundle. Outside an app bundle (tests, `swift
  /// run`) the keys show, which makes a missing catalog obvious.
  private static func bundle(for language: ShellLanguage) -> Bundle {
    Bundle.main.path(forResource: language.rawValue, ofType: "lproj").flatMap(Bundle.init(path:))
      ?? .main
  }
}
