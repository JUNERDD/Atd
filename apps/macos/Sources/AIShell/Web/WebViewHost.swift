import AICore
import AIRelay
import AppKit
import OSLog
import WebKit

/// Owns one window's renderer web view: builds it (shared by the panel and the settings
/// window), locks its navigation down (R6), rebuilds it after a WebContent crash, and runs its
/// end of the bridge: the page's virtual sockets and the one delivery path for everything the
/// shell sends it (``BridgeOutbox``, spike S6).
final class WebViewHost: NSObject {
  let role: WebViewRole
  /// The view windows embed; the web view fills it and is swapped inside it on a rebuild.
  let container = NSView()
  private(set) var webView: ShellWebView
  /// The current page's stream connections; replaced with the web view.
  private(set) var pipe: VirtualSocketPipe?
  /// Counts committed documents, so a call's answer never reaches a later page.
  private(set) var document = 0

  /// Receives dropped and pasted file URLs; the panel imports them as attachments.
  var onFiles: ((_ files: [URL], _ source: String) -> Void)? {
    didSet { webView.onFiles = onFiles }
  }
  /// Receives a pasted bitmap that came without file URLs or text; the panel imports it as an
  /// image attachment.
  var onPastedImage: ((_ data: Data) -> Void)? {
    didSet { webView.onPastedImage = onPastedImage }
  }

  private let fragment: String?
  private let services: ShellServices
  private let bridge: ShellBridge
  private var outbox = BridgeOutbox()
  private var crashes: [ContinuousClock.Instant] = []
  private var displayOptionsObserver: NSObjectProtocol?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "web")

  init(role: WebViewRole, fragment: String?, services: ShellServices, bridge: ShellBridge) {
    self.role = role
    self.fragment = fragment
    self.services = services
    self.bridge = bridge
    let handler = BridgeMessageHandler(bridge: bridge)
    webView = Self.makeWebView(services: services, handler: handler)
    super.init()
    handler.host = self
    install(webView)
    followReduceTransparency()
  }

  func load() {
    webView.load(URLRequest(url: RendererOrigin.pageURL(fragment: fragment)))
  }

  func close() {
    if let displayOptionsObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(displayOptionsObserver)
    }
    pipe?.invalidate()
    pipe = nil
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.removeFromSuperview()
  }

  /// Keeps the page's `accessibility.reduceTransparency` state on the system setting: WebKit has
  /// no `prefers-reduced-transparency`, so the page turns its glass opaque from this state.
  private func followReduceTransparency() {
    sendReduceTransparency()
    displayOptionsObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.sendReduceTransparency() } }
  }

  private func sendReduceTransparency() {
    let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    setState(.accessibilityReduceTransparency(.init(reduce: reduce)))
  }

  // MARK: Delivery

  /// A state event (window activity, visibility): the latest value reaches every ready page.
  func setState(_ event: NativeEvent) {
    act(outbox.setState(event))
  }

  /// An event for whichever page is ready next (`app`), or only for the current one.
  func send(_ event: NativeEvent, scope: BridgeOutbox.Scope = .app) {
    act(outbox.post(.event(event), scope: scope))
  }

  /// A call's answer, dropped when the page that called is gone.
  func reply(_ message: SwiftMessage, document: Int) {
    guard document == self.document else { return }
    act(outbox.post(message, scope: .document))
  }

  func pageDidBecomeReady() {
    act(outbox.pageDidBecomeReady())
  }

  func setDragRegions(_ rects: [WindowDragRegionsPost.Rect]) {
    webView.dragRegions = rects.filter { $0.width > 0 && $0.height > 0 }.map {
      CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
    }
  }

  private func post(frame: SocketFrame) {
    act(outbox.post(frame: frame, bytes: frame.byteCost))
  }

  private func act(_ action: BridgeOutbox.Action) {
    guard action == .flush else { return }
    // The next main-queue turn, so what arrives in this one shares the call.
    DispatchQueue.main.async { MainActor.assumeIsolated { self.flush() } }
  }

  /// Delivers one message as `window.aiNative.deliver(message)`; the page handles it
  /// synchronously, and its completion lets the next one go.
  private func flush() {
    guard let message = outbox.next() else { return }
    let argument: Any
    do {
      argument = try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(message), options: .fragmentsAllowed)
    } catch {
      Self.log.fault("A bridge message could not be encoded: \(error)")
      return act(outbox.completed(delivered: true))
    }
    webView.callAsyncJavaScript(
      NativeBridgeContract.deliverScript,
      arguments: [NativeBridgeContract.deliverArgument: argument], in: nil, in: .page
    ) { [weak self] result in
      MainActor.assumeIsolated {
        guard let self else { return }
        var delivered = true
        if case .failure(let error) = result {
          delivered = false
          Self.log.error("The \(self.role.rawValue) page did not take a message: \(error)")
        }
        self.act(self.outbox.completed(delivered: delivered))
      }
    }
  }

  // MARK: Building

  private static func makeWebView(services: ShellServices, handler: BridgeMessageHandler)
    -> ShellWebView
  {
    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(services.schemeHandler, forURLScheme: RendererOrigin.scheme)
    configuration.userContentController.add(
      handler, contentWorld: .page, name: NativeBridgeContract.messageHandler)
    configuration.preferences.isElementFullscreenEnabled = false
    // In-page Liquid Glass for `surface-glass` overlays, and a transparent page over the
    // window's glass (spike S5, decision R5).
    WebKitPrivate.enableSystemAppearance(configuration.preferences)
    let webView = ShellWebView(frame: .zero, configuration: configuration)
    WebKitPrivate.disableBackground(webView)
    webView.underPageBackgroundColor = .clear
    webView.allowsMagnification = false
    webView.allowsBackForwardNavigationGestures = false
    #if DEBUG
      webView.isInspectable = true
    #endif
    webView.autoresizingMask = [.width, .height]
    return webView
  }

  private func install(_ webView: ShellWebView) {
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.onFiles = onFiles
    webView.onPastedImage = onPastedImage
    webView.frame = container.bounds
    container.addSubview(webView)
    pipe = VirtualSocketPipe(link: services.link) { [weak self] in self?.post(frame: $0) }
  }

  /// The page went away: its sockets close, and results and frames meant for it are dropped.
  private func pageDidUnload() {
    document += 1
    pipe?.resetForNewDocument()
    outbox.pageDidUnload()
  }

  /// Rebuilds the web view after its WebContent process died, keeping queued events for the
  /// new page. Three crashes within a minute stop the rebuilds so a page that crashes on load
  /// cannot spin.
  private func rebuild() {
    let now = ContinuousClock.now
    crashes = crashes.filter { now - $0 < .seconds(60) } + [now]
    guard crashes.count <= 3 else {
      Self.log.fault("The \(self.role.rawValue) page keeps crashing; not rebuilding it again.")
      return
    }
    let old = webView
    let wasFirstResponder = old.window?.firstResponder === old
    close()
    let handler = BridgeMessageHandler(bridge: bridge)
    let replacement = Self.makeWebView(services: services, handler: handler)
    handler.host = self
    replacement.dragRegions = old.dragRegions
    webView = replacement
    install(replacement)
    if wasFirstResponder { replacement.window?.makeFirstResponder(replacement) }
    load()
  }
}

extension WebViewHost: WKNavigationDelegate, WKUIDelegate {
  /// Plan decision R6: subframes never navigate, the main frame stays on the renderer origin.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
  ) async -> WKNavigationActionPolicy {
    let allowed = RendererOrigin.allowsNavigation(
      to: navigationAction.request.url,
      targetIsMainFrame: navigationAction.targetFrame?.isMainFrame == true)
    return allowed ? .allow : .cancel
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    guard webView === self.webView else { return }
    // A committed main-frame load replaced the page; it announces itself again when ready.
    pageDidUnload()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView else { return }
    Self.log.error("The \(self.role.rawValue) WebContent process terminated; rebuilding.")
    pageDidUnload()
    rebuild()
  }

  /// `window.open` and `target=_blank` open nothing; links go through the bridge's `link.open`.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }
}
