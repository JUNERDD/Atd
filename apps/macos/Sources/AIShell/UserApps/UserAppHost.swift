import AICore
import AIRelay
import AppKit
import OSLog
import WebKit

/// A user app's web view. Edit › Paste sends `pasteAttachingFiles:` (the renderer's paste,
/// ``ShellWebView``); here it is WebKit's plain paste, so ⌘V works in an app's fields. A glass
/// window moves from the drag regions its page reports (``WindowDraggingWebView``).
final class UserAppWebView: WindowDraggingWebView {
  @objc func pasteAttachingFiles(_ sender: Any?) {
    NSApp.sendAction(#selector(NSText.paste(_:)), to: self, from: sender)
  }
}

/// The state of a glass page's window that its styles key off (``UserAppPageScripts``).
private struct WindowState: Equatable {
  var active: Bool
  var reduceTransparency: Bool
}

/// Hosts one user app's page. Its configuration is built here and nowhere else, and holds none
/// of the renderer's: no `ai-app` handler, no `aiNative` bridge, no relay or virtual sockets. It
/// has instead:
/// - the shared ``UserAppSchemeHandler`` for `ai-userapp`, which answers this web view as
///   ``appId`` because the registry says so;
/// - the app's own persistent `WKWebsiteDataStore(forIdentifier:)`, so its storage survives
///   relaunches and stays apart from every other app and the renderer;
/// - the app's content rule list (``UserAppContentPolicy``);
/// - the `atdApp` bridge (``UserAppMessageHandler``) and the document-start error capture.
///
/// A glass window's page (``UserAppRuntime/Surface/glass``) also gets what the renderer's pages
/// get on the same window material: the two private WebKit settings (``WebKitPrivate``), so the
/// page is transparent over the window's glass and its overlays render WebKit's in-page system
/// glass; the window state on its root element, from the isolated `.defaultClient` world; and the
/// drag regions of its title bar strip (``UserAppPageScripts``). An opaque window's page gets none
/// of them.
///
/// Navigation is locked: the main frame stays on `ai-userapp://<appId>/`, subframes never load,
/// new windows are never created, and a clicked web link goes to the browser only after the
/// user confirms (``onExternalLink``).
final class UserAppHost: NSObject {
  let appId: String
  /// The window material, fixed for the host's life: a version on another surface opens in a
  /// new window (``UserAppWindows``).
  let surface: UserAppRuntime.Surface
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
  /// A glass page's window state; inactive until the window first becomes key.
  private var state: WindowState
  private var reduceTransparency: ReduceTransparencyObserver?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(
    runtime: UserAppRuntime, dataStore: UUID, rules: WKContentRuleList,
    schemeHandler: UserAppSchemeHandler, bridge: UserAppBridge
  ) {
    appId = runtime.appId
    surface = runtime.surface
    self.runtime = runtime
    session = UserAppSession(appId: runtime.appId, webRoot: runtime.webRootURL)
    self.schemeHandler = schemeHandler
    self.rules = rules
    self.bridge = bridge
    state = WindowState(active: false, reduceTransparency: ReduceTransparencyObserver.isReduced)
    webView = Self.makeWebView(
      surface: runtime.surface, state: state, dataStore: dataStore, rules: rules,
      schemeHandler: schemeHandler, bridge: bridge)
    super.init()
    install(webView)
    if surface == .glass {
      reduceTransparency = ReduceTransparencyObserver { [weak self] reduce in
        guard let self else { return }
        setState(WindowState(active: state.active, reduceTransparency: reduce))
      }
    }
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

  /// The window became key or resigned it.
  func setWindowActive(_ active: Bool) {
    setState(WindowState(active: active, reduceTransparency: state.reduceTransparency))
  }

  /// `window.dragRegions` from the current page.
  func setDragRegions(_ rects: [UserAppWindowDragRegionsPost.Rect]) {
    webView.dragRegions = rects.filter { $0.width > 0 && $0.height > 0 }.map {
      CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
    }
  }

  /// Gives a glass page its window's state: the current page at once, and every later page at
  /// document start, since each load runs the scripts as they were when it started.
  private func setState(_ next: WindowState) {
    guard surface == .glass, next != state else { return }
    state = next
    let controller = webView.configuration.userContentController
    controller.removeAllUserScripts()
    Self.addUserScripts(to: controller, surface: surface, state: next)
    pushState()
  }

  /// Writes the state into the current page.
  private func pushState() {
    webView.callAsyncJavaScript(
      UserAppPageScripts.applyWindowState,
      arguments: ["active": String(state.active), "reduce": String(state.reduceTransparency)],
      in: nil, in: .defaultClient)
  }

  /// Takes the web view down for good: no message is heard and no request answered afterwards.
  /// The window releases the view; the data store can be removed once it is gone.
  func close() {
    reduceTransparency?.stop()
    reduceTransparency = nil
    tearDown()
  }

  private func tearDown() {
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
    surface: UserAppRuntime.Surface, state: WindowState, dataStore: UUID,
    rules: WKContentRuleList, schemeHandler: UserAppSchemeHandler, bridge: UserAppBridge
  ) -> UserAppWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: dataStore)
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: UserAppSchemeHandler.scheme)
    let controller = configuration.userContentController
    controller.add(rules)
    controller.addScriptMessageHandler(
      UserAppMessageHandler(bridge: bridge), contentWorld: .page,
      name: UserAppBridge.messageHandler)
    addUserScripts(to: controller, surface: surface, state: state)
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // A glass page: in-page Liquid Glass for its overlays (set before the view exists), and a
    // transparent page over the window's glass, as the renderer's (spike S5, decision R5).
    if surface == .glass { WebKitPrivate.enableSystemAppearance(configuration.preferences) }
    let webView = UserAppWebView(frame: .zero, configuration: configuration)
    if surface == .glass {
      WebKitPrivate.disableBackground(webView)
      webView.underPageBackgroundColor = .clear
    }
    webView.allowsBackForwardNavigationGestures = false
    #if DEBUG
      webView.isInspectable = true
    #endif
    webView.autoresizingMask = [.width, .height]
    return webView
  }

  private static let errorCapture = UserAppErrorCapture.script(
    messageHandler: UserAppBridge.messageHandler)
  private static let dragRegions = UserAppPageScripts.dragRegions(
    messageHandler: UserAppBridge.messageHandler)

  /// The document-start scripts: the error capture on every page; on a glass page also the drag
  /// regions of its title bar strip and its window's `state`.
  private static func addUserScripts(
    to controller: WKUserContentController, surface: UserAppRuntime.Surface, state: WindowState
  ) {
    let atStart = { (source: String, world: WKContentWorld) in
      controller.addUserScript(
        WKUserScript(
          source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
    }
    atStart(errorCapture, .page)
    guard surface == .glass else { return }
    atStart(dragRegions, .page)
    atStart(
      UserAppPageScripts.windowState(
        active: state.active, reduceTransparency: state.reduceTransparency), .defaultClient)
  }

  private func install(_ webView: UserAppWebView) {
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.frame = container.bounds
    container.addSubview(webView)
  }

  /// Rebuilds the web view after its WebContent process died, keeping its drag regions until the
  /// new page reports its own. Three crashes within a minute stop the rebuilds so a page that
  /// crashes on load cannot spin.
  private func rebuild() {
    let now = ContinuousClock.now
    crashes = crashes.filter { now - $0 < .seconds(60) } + [now]
    guard crashes.count <= 3 else {
      return Self.log.fault("The app \(self.appId, privacy: .public) keeps crashing.")
    }
    guard let dataStore = runtime.dataStore else { return }
    let old = webView
    let wasFirstResponder = old.window?.firstResponder === old
    tearDown()
    let replacement = Self.makeWebView(
      surface: surface, state: state, dataStore: dataStore, rules: rules,
      schemeHandler: schemeHandler, bridge: bridge)
    replacement.dragRegions = old.dragRegions
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

  /// A state change while this load was starting may have missed both its document-start script
  /// and the previous page, so a glass page gets the state again once committed.
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if webView === self.webView, surface == .glass { pushState() }
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
