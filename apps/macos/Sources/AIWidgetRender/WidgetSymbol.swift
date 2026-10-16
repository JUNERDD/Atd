import AppKit

/// Resolves the SF Symbol names a widget draws. Names come from generated apps, and the service
/// only checks their spelling (`^[a-z0-9.]+$`), so a name can be well formed yet missing from the
/// system the widget runs on: SF Symbols grow with each macOS release, and an app written on a
/// newer system can name a symbol that macOS 15 does not have. `Image(systemName:)` draws nothing
/// for such a name, which looks like a broken widget.
enum WidgetSymbol {
  /// Shown in place of a name the running system cannot resolve. It has been in SF Symbols since
  /// macOS 12, so it resolves everywhere the widgets run.
  static let placeholder = "questionmark.square.dashed"

  /// `name` when the running system has that symbol, otherwise ``placeholder``. Every
  /// `Image(systemName:)` in this module takes its name from here.
  static func resolved(_ name: String) -> String {
    NSImage(systemSymbolName: name, accessibilityDescription: nil) == nil ? placeholder : name
  }
}
