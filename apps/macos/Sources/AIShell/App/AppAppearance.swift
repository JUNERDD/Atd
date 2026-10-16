import AICore
import AppKit
import Observation

/// The app-wide light or dark appearance, the one owner of the user's Theme setting in the shell.
/// The panel page pushes the setting (`appearance.set`: light, dark, or nil to follow the system)
/// after settings load and on every change; ``apply(_:)`` sets it on `NSApp`, so every window,
/// every material and every web view's `prefers-color-scheme` follow it with nothing more to tell
/// them. The setting is kept in the user defaults and restored at launch (``restore()``), before
/// any window or web view exists, so the first frame after launch is already in its scheme.
///
/// It also resolves the scheme the app's windows take now (``isDark``) for the surfaces that pin
/// their own appearance rather than inherit it, the shell's glass (``GlassSurface``): SwiftUI
/// views read it through observation, and AppKit glass is told on every change, whether the
/// setting changed or the system did while the app follows it.
@Observable
final class AppAppearance {
  static let shared = AppAppearance()

  /// Whether the app's windows resolve to the dark scheme now (`NSApp.effectiveAppearance`).
  private(set) var isDark: Bool

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private var observation: NSKeyValueObservation?

  /// The defaults key of the last applied setting; absent while the app follows the system.
  private static let key = "appAppearance"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    isDark = Self.resolveDark()
  }

  /// Applies the stored setting and follows the app's effective appearance from then on. Call it
  /// once at launch, before the first window is made.
  func restore() {
    let stored = defaults.string(forKey: Self.key).flatMap(AppearanceSetPost.Appearance.init)
    NSApplication.shared.appearance = Self.appearance(for: stored)
    // The app's effective appearance changes with its own setting and, while that follows the
    // system, with the system's; both reach the glass through here.
    observation = NSApplication.shared.observe(\.effectiveAppearance) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    refresh()
  }

  /// Applies and keeps `preference`: nil follows the system.
  func apply(_ preference: AppearanceSetPost.Appearance?) {
    if let preference {
      defaults.set(preference.rawValue, forKey: Self.key)
    } else {
      defaults.removeObject(forKey: Self.key)
    }
    let next = Self.appearance(for: preference)
    guard NSApplication.shared.appearance?.name != next?.name else { return }
    NSApplication.shared.appearance = next
    // KVO reports the change too; resolving here as well keeps the glass in step even before it.
    refresh()
  }

  /// Takes the effective appearance's scheme and, when it changed, re-tells the live glass.
  private func refresh() {
    let dark = Self.resolveDark()
    guard dark != isDark else { return }
    isDark = dark
    GlassSurface.schemeDidChange()
  }

  private static func appearance(for preference: AppearanceSetPost.Appearance?) -> NSAppearance? {
    switch preference {
    case .light: NSAppearance(named: .aqua)
    case .dark: NSAppearance(named: .darkAqua)
    case nil: nil
    }
  }

  private static func resolveDark() -> Bool {
    NSApplication.shared.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
  }
}
