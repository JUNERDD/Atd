import AICore
import AIRelay
import AppKit
import OSLog
import WebKit

/// The registry of user app windows: at most one per app, keyed by app id. It is the authority
/// the scheme handler and the `atdApp` bridge ask which app a web view shows, so an app's id
/// always comes from the window that made a request, never from the page.
///
/// Opening asks the service for the app's runtime (`GET /v1/apps/:appId/runtime`) every time:
/// an open window comes to the front and reloads when the version changed, and the app's data
/// store id is remembered, since after a deletion only the shell still knows it. Clearing an
/// app's data and deleting it are the renderer's `userApp.clearData`, sent after the service's
/// own reset or deletion (``clearData(appId:forget:)``).
final class UserAppWindows {
  private let services: ShellServices
  let storage: UserAppStorage
  private let confirmations: ConfirmationPrompter
  private var windows: [String: UserAppWindowController] = [:]
  /// Apps whose runtime is being fetched, so a double click opens one window.
  private var opening: Set<String> = []
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  /// `userApp.state` for the renderer's pages: whether the app's window is open and the version
  /// it shows (nil while closed).
  var onState: ((_ appId: String, _ open: Bool, _ version: Int?) -> Void)?

  private(set) lazy var schemeHandler = UserAppSchemeHandler(link: services.link) {
    [weak self] webView in self?.host(for: webView)?.session
  }
  private(set) lazy var bridge = UserAppBridge(
    services: services, windows: self, confirmations: confirmations)

  init(services: ShellServices, storage: UserAppStorage, confirmations: ConfirmationPrompter) {
    self.services = services
    self.storage = storage
    self.confirmations = confirmations
  }

  /// The host whose current web view is `webView`; nil for any other web view.
  func host(for webView: WKWebView?) -> UserAppHost? {
    guard let webView else { return nil }
    return windows.values.first { $0.host.webView === webView }?.host
  }

  /// The app window that is key, for the Edit menu.
  var keyHost: UserAppHost? { windows.values.first(where: \.isKey)?.host }

  /// `userApp.open`: focuses the app's window or opens one, reloading it when the version
  /// changed, or replacing it when the version asks for another window surface. A widget tap
  /// passes the route to show (already checked by ``WidgetLink``).
  func open(appId: String, route: String? = nil) async throws(BridgeError) {
    guard UserAppOrigin.isValidAppId(appId) else {
      throw BridgeError(ShellStrings.shared.text(.userAppOpenFailed))
    }
    guard !opening.contains(appId) else { return }
    opening.insert(appId)
    defer { opening.remove(appId) }
    let runtime: UserAppRuntime
    do {
      runtime = try await services.client().appRuntime(appId: appId)
    } catch {
      Self.log.error("An app's runtime failed: \(String(describing: error), privacy: .public)")
      throw BridgeError(
        ShellStrings.shared.text(Self.isGone(error) ? .userAppOpenMissing : .userAppOpenFailed))
    }
    guard let dataStore = runtime.dataStore else {
      throw BridgeError(ShellStrings.shared.text(.userAppOpenFailed))
    }
    storage.rememberDataStore(dataStore, appId: appId)
    if let window = windows[appId], window.host.surface == runtime.surface {
      window.update(runtime)
      if let route { window.host.load(route: route) }
      window.show()
      return notify(appId)
    }
    let rules: WKContentRuleList
    do {
      rules = try await storage.ruleList(appId: appId)
    } catch {
      Self.log.error("An app's rule list failed: \(String(describing: error), privacy: .public)")
      throw BridgeError(ShellStrings.shared.text(.userAppOpenFailed))
    }
    // Another open of the same app may have finished while this one waited.
    if let window = windows[appId], window.host.surface == runtime.surface {
      window.show()
      return
    }
    if let window = windows[appId] {
      // A version on another window surface: a live window cannot swap its material and title
      // bar, so it closes, remembering its frame, and the new one opens there. The app stays
      // open for the renderer throughout.
      window.onClose = nil
      window.close()
    }
    let host = UserAppHost(
      runtime: runtime, dataStore: dataStore, rules: rules, schemeHandler: schemeHandler,
      bridge: bridge)
    host.onExternalLink = { [weak self, weak host] url in
      guard let self, let host else { return }
      Task { await self.openExternalLink(url, from: host) }
    }
    let window = UserAppWindowController(host: host, storage: storage)
    window.onClose = { [weak self] appId in
      self?.windows[appId] = nil
      self?.notify(appId)
    }
    host.onFirstReady = { [weak window] in window?.show() }
    windows[appId] = window
    host.load(route: route)
    notify(appId)
  }

  /// `userApp.close`: closes the app's window if open.
  func close(appId: String) {
    windows[appId]?.close()
  }

  /// `userApp.clearData`: closes the app's window, which releases its web view, then removes
  /// its website data store; with `forget` (a deleted app) also its rule list and frame.
  func clearData(appId: String, forget: Bool) async throws(BridgeError) {
    guard UserAppOrigin.isValidAppId(appId) else {
      throw BridgeError(ShellStrings.shared.text(.userAppClearFailed))
    }
    windows[appId]?.close()
    guard await storage.clearData(appId: appId, forget: forget) else {
      throw BridgeError(ShellStrings.shared.text(.userAppClearFailed))
    }
  }

  /// Opens a web link the app asked for (a click or `link.open`) once the user confirms; the
  /// link is the page's, so the user sees exactly where it goes. False when declined.
  @discardableResult
  func openExternalLink(_ url: URL, from host: UserAppHost) async -> Bool {
    let strings = ShellStrings.shared
    let prompt = ConfirmationPrompt(
      title: strings.text(.userAppLinkTitle),
      message: strings.catalog(.userAppLinkMessage, host.runtime.name, url.absoluteString),
      buttons: [
        .init(title: strings.text(.userAppLinkOpen), choice: true, isDefault: true),
        .init(title: strings.text(.cancel), choice: false, isCancel: true),
      ])
    guard await confirmations.ask(prompt) == true else { return false }
    NSWorkspace.shared.open(url)
    return true
  }

  private func notify(_ appId: String) {
    let version = windows[appId]?.host.runtime.version
    onState?(appId, version != nil, version)
  }

  /// The service no longer has the app.
  private static func isGone(_ error: any Error) -> Bool {
    if case .http(let status, _, _) = error as? ShellClientError { return status == 404 }
    return false
  }
}
