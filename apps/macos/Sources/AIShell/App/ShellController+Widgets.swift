import AICore
import AIWidgetModel
import Foundation
import OSLog

/// Desktop widgets: keeping the extension's files current, the desktop pins, and opening an app
/// from a widget tap or a pin's click.
extension ShellController {
  private static let widgetLog = Logger(subsystem: "com.junerdd.ai", category: "widgets")

  /// Shows the saved desktop pins, then pulls on every widget invalidation; the first pull runs
  /// once the control stream connects.
  func startWidgets() {
    control.onWidgetsInvalidated = { [weak self] in self?.widgets.invalidated() }
    startDesktopPins()
    widgets.start()
  }

  /// A widget tap's URL (``WidgetLink``), the only non-file URL the shell accepts: it shows the
  /// task panel, or opens an app's window at the route, and nothing else. A link without a route
  /// (a launcher tile) brings an open window forward without reloading it.
  func openWidgetLink(_ url: URL) {
    guard let scheme = WidgetLink.mainBundleScheme,
      let link = WidgetLink.parse(url, scheme: scheme)
    else { return Self.widgetLog.error("Refused a URL that is not a widget link.") }
    guard case .app(let appId, let route) = link else { return showPanel() }
    openUserAppWhenConnected(appId, route: route)
  }

  /// Opens an app's window for a widget or a desktop pin, at `route` or as it is. A cold launch
  /// from a tap arrives before the service is up, so the open waits, bounded, for the control
  /// stream to connect.
  func openUserAppWhenConnected(_ appId: String, route: String?) {
    Task {
      let deadline = ContinuousClock.now + .seconds(60)
      while control.state != .connected, ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(500))
      }
      do throws(BridgeError) {
        try await openUserApp(appId, route: route)
      } catch {
        let reason = error.message
        Self.widgetLog.error("A widget could not open its app: \(reason, privacy: .public)")
      }
    }
  }
}
