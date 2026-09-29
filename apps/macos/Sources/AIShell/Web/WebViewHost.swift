import AICore
import AppKit
import OSLog
import WebKit

/// Owns one window's renderer web view: builds it (shared by the panel and the settings
/// window), locks its navigation down, rebuilds it after a WebContent crash, and delivers
/// shell events through a ``ShellEventOutbox`` once the page says it is ready.
@MainActor
final class WebViewHost: NSObject {
  let role: WebViewRole
  /// The view windows embed; the web view fills it and is swapped inside it on a rebuild.
  let container = NSView()
  private(set) var webView: ShellWebView

  /// Receives dropped and pasted file URLs; the panel imports them as attachments.
  var onFiles: ((_ files: [URL], _ source: String) -> Void)? {
    didSet { webView.onFiles = onFiles }
  }

  private let fragment: String?
  private let webContent: any WebContentProviding
  private let router: any BridgeRouting
  private var outbox = ShellEventOutbox()
  private var crashes: [ContinuousClock.Instant] = []
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "web")

  init(
    role: WebViewRole, fragment: String?, webContent: any WebContentProviding,
    router: any BridgeRouting
  ) {
    self.role = role
    self.fragment = fragment
    self.webContent = webContent
    self.router = router
    let bridge = BridgeMessageHandler(router: router)
    webView = Self.makeWebView(role: role, webContent: webContent, bridge: bridge)
    super.init()
    bridge.host = self
    install(webView)
  }

  func load() {
    webView.load(URLRequest(url: RendererOrigin.pageURL(fragment: fragment)))
  }

  func close() {
    webContent.webViewWillDetach(webView, role: role)
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.removeFromSuperview()
  }

  // MARK: Events

  func send(_ event: ShellEvent) {
    outbox.post(event)
    flush()
  }

  func setState(_ name: String, _ payload: JSONValue) {
    outbox.setState(name, payload)
    flush()
  }

  func pageDidBecomeReady() {
    outbox.pageDidBecomeReady()
    flush()
  }

  /// `[{ x, y, width, height }]` in CSS pixels; anything else clears the regions.
  func setDragRegions(_ value: JSONValue) {
    guard case .array(let items) = value else {
      webView.dragRegions = []
      return
    }
    webView.dragRegions = items.compactMap { item in
      guard case .number(let x)? = item["x"], case .number(let y)? = item["y"],
        case .number(let width)? = item["width"], case .number(let height)? = item["height"],
        width > 0, height > 0
      else { return nil }
      return CGRect(x: x, y: y, width: width, height: height)
    }
  }

  /// The page receives a batch as `globalThis.__aiShell.receive(events)`, events being
  /// `[{ name, payload }]`, and handles it synchronously (spike S6: one call in flight).
  private func flush() {
    guard let batch = outbox.nextBatch() else { return }
    let target = webView
    Task { @MainActor [weak self] in
      var delivered = false
      do {
        let json = String(
          decoding: try JSONEncoder().encode(batch.map(WireEvent.init)), as: UTF8.self)
        _ = try await target.callAsyncJavaScript(
          "globalThis.__aiShell.receive(JSON.parse(batch)); return true",
          arguments: ["batch": json], contentWorld: .page)
        delivered = true
      } catch {
        Self.log.error(
          "Shell events not delivered to the \(self?.role.rawValue ?? "?") page: \(error)")
      }
      guard let self else { return }
      outbox.batchDidFinish(delivered: delivered)
      // A page that failed to receive is broken or gone; it gets everything again after its
      // next `shell.ready`, instead of a retry loop against a broken receiver.
      if delivered { flush() } else { outbox.pageDidUnload() }
    }
  }

  private struct WireEvent: Encodable {
    let name: String
    let payload: JSONValue
    init(_ event: ShellEvent) {
      name = event.name
      payload = event.payload
    }
  }

  // MARK: Building

  private static func makeWebView(
    role: WebViewRole, webContent: any WebContentProviding, bridge: BridgeMessageHandler
  ) -> ShellWebView {
    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(
      webContent.schemeHandler(for: role), forURLScheme: RendererOrigin.scheme)
    configuration.userContentController.addScriptMessageHandler(
      bridge, contentWorld: .page, name: BridgeMessageHandler.name)
    configuration.preferences.isElementFullscreenEnabled = false
    webContent.configure(configuration, for: role)
    let webView = ShellWebView(frame: .zero, configuration: configuration)
    // Transparent over the window's glass (spike S5, decision R5): there is no public way to
    // stop WKWebView from painting its background.
    webView.setValue(false, forKey: "drawsBackground")
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
    webView.frame = container.bounds
    container.addSubview(webView)
    webContent.webViewDidAttach(webView, role: role)
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
    webContent.webViewWillDetach(old, role: role)
    old.configuration.userContentController.removeAllScriptMessageHandlers()
    let wasFirstResponder = old.window?.firstResponder === old
    let bridge = BridgeMessageHandler(router: router)
    let replacement = Self.makeWebView(role: role, webContent: webContent, bridge: bridge)
    bridge.host = self
    replacement.dragRegions = old.dragRegions
    old.removeFromSuperview()
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
    outbox.pageDidUnload()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView else { return }
    Self.log.error("The \(self.role.rawValue) WebContent process terminated; rebuilding.")
    outbox.pageDidUnload()
    rebuild()
  }

  /// `window.open` and `target=_blank` open nothing; links go through the bridge's `openLink`.
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }
}
