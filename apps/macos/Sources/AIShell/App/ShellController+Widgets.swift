import AICore
import AIWidgetModel
import Foundation
import OSLog

/// Desktop widgets: keeping the extension's files current, and opening an app from a widget tap.
extension ShellController {
  private static let widgetLog = Logger(subsystem: "com.junerdd.ai", category: "widgets")

  /// Pulls on every widget invalidation; the first pull runs once the control stream connects.
  func startWidgets() {
    control.onWidgetsInvalidated = { [weak self] in self?.widgets.invalidated() }
    widgets.start()
  }

  /// A widget tap's URL (``WidgetLink``), the only non-file URL the shell accepts: it shows the
  /// task panel, or opens an app's window at the route, and nothing else. A link without a route
  /// (a launcher tile) brings an open window forward without reloading it. A cold launch from a
  /// tap arrives before the service is up, so an app open waits, bounded, for the control stream
  /// to connect.
  func openWidgetLink(_ url: URL) {
    guard let scheme = WidgetLink.mainBundleScheme,
      let link = WidgetLink.parse(url, scheme: scheme)
    else { return Self.widgetLog.error("Refused a URL that is not a widget link.") }
    guard case .app(let appId, let route) = link else { return showPanel() }
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
