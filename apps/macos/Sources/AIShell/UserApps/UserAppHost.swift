import AICore
import AIRelay
import AppKit
import OSLog
import WebKit

/// A user app's web view. Edit › Paste sends `pasteAttachingFiles:` (the renderer's paste,
/// ``ShellWebView``); here it is WebKit's plain paste, so ⌘V works in an app's fields.
final class UserAppWebView: WKWebView {
  @objc func pasteAttachingFiles(_ sender: Any?) {
    NSApp.sendAction(#selector(NSText.paste(_:)), to: self, from: sender)
  }
}

/// Hosts one user app's page. Its configuration is built here and nowhere else, and holds none
/// of the renderer's: no `ai-app` handler, no `aiNative` bridge, no relay or virtual sockets, no
/// private WebKit preferences. It has instead:
/// - the shared ``UserAppSchemeHandler`` for `ai-userapp`, which answers this web view as
///   ``appId`` because the registry says so;
/// - the app's own persistent `WKWebsiteDataStore(forIdentifier:)`, so its storage survives
///   relaunches and stays apart from every other app and the renderer;
/// - the app's content rule list (``UserAppContentPolicy``);
/// - the `atdApp` bridge (``UserAppMessageHandler``) and the document-start error capture.
///
/// Navigation is locked: the main frame stays on `ai-userapp://<appId>/`, subframes never load,
/// new windows are never created, and a clicked web link goes to the browser only after the
/// user confirms (``onExternalLink``).
final class UserAppHost: NSObject {
  let appId: String
  private(set) var runtime: UserAppRuntime
  /// What the scheme handler serves for this web view.
  private(set) var session: UserAppSession
  private(set) var webView: UserAppWebView
  /// The view the window embeds; the web view fills it and is swapped inside it on a rebuild.
  let container = NSView()
  /// Asked to open a clicked http(s) link in the browser.
  var onExternalLink: ((URL) -> Void)?
  /// Runs once, when the first page can be shown: on its `app.ready`, a second after the main
  /// frame finished loading (a page that never posts it), or when loading failed.
  var onFirstReady: (() -> Void)?

  private let schemeHandler: UserAppSchemeHandler
  private let rules: WKContentRuleList
  private let bridge: UserAppBridge
  private var crashes: [ContinuousClock.Instant] = []
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(
    runtime: UserAppRuntime, dataStore: UUID, rules: WKContentRuleList,
    schemeHandler: UserAppSchemeHandler, bridge: UserAppBridge
  ) {
    appId = runtime.appId
    self.runtime = runtime
    session = UserAppSession(appId: runtime.appId, webRoot: runtime.webRootURL)
    self.schemeHandler = schemeHandler
    self.rules = rules
    self.bridge = bridge
    webView = Self.makeWebView(
      dataStore: dataStore, rules: rules, schemeHandler: schemeHandler, bridge: bridge)
    super.init()
    install(webView)
  }

  /// Loads the app's page, at `route` when given (``UserAppOrigin/pageURL(appId:route:)``).
  func load(route: String? = nil) {
    webView.load(URLRequest(url: UserAppOrigin.pageURL(appId: appId, route: route)))
  }

  /// `app.ready` from the current page.
  func pageDidBecomeReady() { firstReady() }

  private func firstReady() {
    let ready = onFirstReady
    onFirstReady = nil
    ready?()
  }

  /// A new version: serve its files and reload. The same version only updates the name.
  func update(_ next: UserAppRuntime) {
    let reload = next.version != runtime.version || next.webRoot != runtime.webRoot
    runtime = next
    guard reload else { return }
    session = UserAppSession(appId: appId, webRoot: next.webRootURL)
    load()
  }

  /// Takes the web view down: no message is heard and no request answered afterwards. The
  /// window releases the view; the data store can be removed once it is gone.
  func close() {
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    let controller = webView.configuration.userContentController
    controller.removeAllScriptMessageHandlers()
    controller.removeAllUserScripts()
    controller.removeAllContentRuleLists()
    webView.removeFromSuperview()
  }

  private static func makeWebView(
    dataStore: UUID, rules: WKContentRuleList, schemeHandler: UserAppSchemeHandler,
    bridge: UserAppBridge
  ) -> UserAppWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: dataStore)
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: UserAppSchemeHandler.scheme)
    let controller = configuration.userContentController
    controller.add(rules)
    controller.addScriptMessageHandler(
      UserAppMessageHandler(bridge: bridge), contentWorld: .page,
      name: UserAppBridge.messageHandler)
    controller.addUserScript(
      WKUserScript(
        source: UserAppErrorCapture.script(messageHandler: UserAppBridge.messageHandler),
        injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    let webView = UserAppWebView(frame: .zero, configuration: configuration)
    webView.allowsBackForwardNavigationGestures = false
    #if DEBUG
      webView.isInspectable = true
    #endif
    webView.autoresizingMask = [.width, .height]
    return webView
  }

  private func install(_ webView: UserAppWebView) {
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.frame = container.bounds
    container.addSubview(webView)
  }

  /// Rebuilds the web view after its WebContent process died. Three crashes within a minute
  /// stop the rebuilds so a page that crashes on load cannot spin.
  private func rebuild() {
    let now = ContinuousClock.now
    crashes = crashes.filter { now - $0 < .seconds(60) } + [now]
    guard crashes.count <= 3 else {
      return Self.log.fault("The app \(self.appId, privacy: .public) keeps crashing.")
    }
    guard let dataStore = runtime.dataStore else { return }
    let wasFirstResponder = webView.window?.firstResponder === webView
    close()
    let replacement = Self.makeWebView(
      dataStore: dataStore, rules: rules, schemeHandler: schemeHandler, bridge: bridge)
    webView = replacement
    install(replacement)
    if wasFirstResponder { replacement.window?.makeFirstResponder(replacement) }
    load()
  }
}

extension UserAppHost: WKNavigationDelegate, WKUIDelegate {
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
  ) async -> WKNavigationActionPolicy {
    let url = navigationAction.request.url
    let isMainFrame = navigationAction.targetFrame?.isMainFrame == true
    if UserAppOrigin.allowsNavigation(to: url, targetIsMainFrame: isMainFrame, appId: appId) {
      return .allow
    }
    if isMainFrame { offerExternalLink(navigationAction) }
    return .cancel
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard webView === self.webView, onFirstReady != nil else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      MainActor.assumeIsolated { self.firstReady() }
    }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: any Error
  ) {
    if webView === self.webView { firstReady() }
  }

  func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error
  ) {
    if webView === self.webView { firstReady() }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView else { return }
    Self.log.error("The app \(self.appId, privacy: .public) WebContent process terminated.")
    rebuild()
  }

  /// `window.open` and `target=_blank` never open a window; a clicked web link is offered to
  /// the browser like any other.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    offerExternalLink(navigationAction)
    return nil
  }

  /// Only a link the user clicked, never a script's navigation, and only http and https.
  private func offerExternalLink(_ action: WKNavigationAction) {
    guard action.navigationType == .linkActivated,
      let url = action.request.url.flatMap({ ExternalLink.openable($0.absoluteString) })
    else { return }
    onExternalLink?(url)
  }
}
