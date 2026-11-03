import AICore
import AppKit

/// Follows the system facts a page derives the panel background from (`appearance.system`): the
/// accent color, which the `accent` tint takes its hue from, and whether the windows stand on
/// Liquid Glass, the only material whose variant, blur and refraction the setting changes. Reports
/// them at once and again whenever the system's colors change (any of them, so a report can
/// repeat the last; a page's outbox sends a state only when it changed), until ``stop()``.
final class SystemAppearanceObserver {
  private var observer: NSObjectProtocol?

  /// The facts now.
  static var current: AppearanceSystemEvent {
    let liquidGlass: Bool
    if #available(macOS 26, *) { liquidGlass = true } else { liquidGlass = false }
    return AppearanceSystemEvent(accentColor: accentColor, liquidGlass: liquidGlass)
  }

  /// `NSColor.controlAccentColor` as sRGB `#rrggbb`. The accent is a dynamic color whose dark
  /// variant is lighter; it resolves in the light appearance, whatever the app's, so the report
  /// follows the user's accent alone and matches the renderer's default (`#007aff`, the light
  /// system blue). The page uses only its hue.
  private static var accentColor: String {
    var hex = "#007aff"
    NSAppearance(named: .aqua)?.performAsCurrentDrawingAppearance {
      guard let color = NSColor.controlAccentColor.usingColorSpace(.sRGB) else { return }
      let channels = [color.redComponent, color.greenComponent, color.blueComponent].map {
        Int((min(max($0, 0), 1) * 255).rounded())
      }
      hex = "#" + channels.map { String(format: "%02x", $0) }.joined()
    }
    return hex
  }

  /// Calls `report` with the facts now and again whenever the system's colors change.
  init(report: @escaping @MainActor (_ facts: AppearanceSystemEvent) -> Void) {
    report(Self.current)
    observer = NotificationCenter.default.addObserver(
      forName: NSColor.systemColorsDidChangeNotification, object: nil, queue: .main
    ) { _ in MainActor.assumeIsolated { report(Self.current) } }
  }

  /// Ends the reports; the owner calls it when its page goes away.
  func stop() {
    guard let observer else { return }
    NotificationCenter.default.removeObserver(observer)
    self.observer = nil
  }
}
