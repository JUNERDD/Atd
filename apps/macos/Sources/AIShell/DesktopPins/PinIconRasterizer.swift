import AIWidgetModel
import AppKit
import OSLog
import WebKit

/// Draws an app's `icon.svg` into a bitmap for its desktop pin's tile, out of the shell's process.
///
/// The SVG is untrusted: an agent wrote it, and the shell never parses it (``WidgetLauncherWriter``).
/// The shell only checks its bytes (``WidgetLauncherIcon/accepts(_:)``) and hands them, as a
/// `data:` URL in an `<img>`, to an off-screen web view whose WebContent process decodes them:
/// JavaScript off, a non-persistent data store, no navigation but the page itself, and a page
/// whose CSP (`default-src 'none'; img-src data:`) admits that image and nothing else. An SVG in
/// an `<img>` runs no script and loads no resource anyway; the spike in `tmp/w-pin/` checked that
/// scripts, `http:` and `file:` references and `foreignObject` stay inert. The shell then takes
/// the web view's snapshot, a bitmap, and draws it into an sRGB bitmap of the tile's icon size;
/// an all-transparent result (an SVG that does not decode) counts as no icon.
///
/// One web view serves every icon, one at a time, and is released after a few idle seconds, so
/// no WebContent process stays behind for the pins. Each app's result, a failure included, is
/// kept until its icon's bytes change.
final class PinIconRasterizer: NSObject, WKNavigationDelegate {
  private static let side = WidgetLauncherLayout.pinTile.iconSide
  /// The user agent style sheet's body margin, where the image sits; the CSP admits no style.
  private static let margin = 8.0
  private static let loadTimeout: Duration = .seconds(5)
  private static let idleTime: Duration = .seconds(10)
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "desktop-pins")

  private var cache: [String: (svg: Data, image: CGImage?)] = [:]
  private var tail: Task<Void, Never>?
  private var webView: WKWebView?
  private var window: NSWindow?
  private var loading: (id: Int, continuation: CheckedContinuation<Void, any Error>)?
  private var loads = 0
  private var idleRelease: Task<Void, Never>?

  private struct LoadFailed: Error {}

  /// The image drawn for the app's icon, whichever bytes it came from.
  func cached(appId: String) -> CGImage? { cache[appId]?.image }

  /// Whether `svg` still has to be drawn for the app.
  func needsDrawing(appId: String, svg: Data) -> Bool { cache[appId]?.svg != svg }

  func forget(appId: String) { cache[appId] = nil }

  /// The icon drawn at the tile's size, from the cache when the bytes are unchanged.
  func image(appId: String, svg: Data) async -> CGImage? {
    if let cached = cache[appId], cached.svg == svg { return cached.image }
    let previous = tail
    let job = Task { () -> CGImage? in
      await previous?.value
      return await self.draw(svg)
    }
    tail = Task { _ = await job.value }
    let image = await job.value
    cache[appId] = (svg, image)
    return image
  }

  private func draw(_ svg: Data) async -> CGImage? {
    guard WidgetLauncherIcon.accepts(svg), let webView = webView ?? makeWebView() else {
      return nil
    }
    idleRelease?.cancel()
    defer { scheduleRelease() }
    let side = Int(Self.side)
    let html = """
      <!doctype html><meta http-equiv="Content-Security-Policy" \
      content="default-src 'none'; img-src data:"><img alt="" width="\(side)" height="\(side)" \
      src="data:image/svg+xml;base64,\(svg.base64EncodedString())">
      """
    do {
      try await load(html, in: webView)
      let configuration = WKSnapshotConfiguration()
      configuration.rect = CGRect(
        x: Self.margin, y: Self.margin, width: Self.side, height: Self.side)
      configuration.afterScreenUpdates = true
      let snapshot = try await webView.takeSnapshot(configuration: configuration)
      return Self.bitmap(snapshot, pixels: WidgetLauncherLayout.pinTile.iconPixels)
    } catch {
      Self.log.notice("An app icon was not drawn: \(String(describing: error), privacy: .public)")
      return nil
    }
  }

  /// Loads the page, failing after ``loadTimeout`` so one stuck icon cannot hold the others.
  private func load(_ html: String, in webView: WKWebView) async throws {
    loads += 1
    let id = loads
    let timeout = Task {
      try? await Task.sleep(for: Self.loadTimeout)
      self.finishLoad(id: id, with: LoadFailed())
    }
    defer { timeout.cancel() }
    try await withCheckedThrowingContinuation { continuation in
      loading = (id, continuation)
      webView.loadHTMLString(html, baseURL: nil)
    }
  }

  private func finishLoad(id: Int? = nil, with error: (any Error)?) {
    guard let loading, id == nil || loading.id == id else { return }
    self.loading = nil
    if let error {
      loading.continuation.resume(throwing: error)
    } else {
      loading.continuation.resume()
    }
  }

  private func makeWebView() -> WKWebView? {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    configuration.suppressesIncrementalRendering = true
    let frame = CGRect(
      x: 0, y: 0, width: Self.side + Self.margin * 2, height: Self.side + Self.margin * 2)
    let webView = WKWebView(frame: frame, configuration: configuration)
    // An opaque page would leave the icon's transparent corners white.
    guard WebKitPrivate.disableBackground(webView) else { return nil }
    webView.navigationDelegate = self
    // Far off every display, in a window that never shows in Mission Control or the window cycle.
    let window = NSWindow(
      contentRect: frame.offsetBy(dx: -20_000, dy: -20_000), styleMask: [.borderless],
      backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.transient, .ignoresCycle]
    window.isExcludedFromWindowsMenu = true
    window.ignoresMouseEvents = true
    window.contentView = webView
    window.orderBack(nil)
    self.webView = webView
    self.window = window
    return webView
  }

  private func scheduleRelease() {
    idleRelease = Task {
      try? await Task.sleep(for: Self.idleTime)
      guard !Task.isCancelled, self.loading == nil else { return }
      self.tearDown()
    }
  }

  /// Releases the web view, which ends its WebContent process.
  private func tearDown() {
    webView?.navigationDelegate = nil
    webView = nil
    window?.contentView = nil
    window?.close()
    window = nil
  }

  /// A `pixels`-square sRGB bitmap of the snapshot; nil when nothing was drawn.
  private static func bitmap(_ image: NSImage, pixels: Int) -> CGImage? {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: pixels * 4,
        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let previous = NSGraphicsContext.current
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    image.draw(in: CGRect(x: 0, y: 0, width: pixels, height: pixels))
    NSGraphicsContext.current = previous
    guard let data = context.data else { return nil }
    let bytes = UnsafeBufferPointer(
      start: data.bindMemory(to: UInt8.self, capacity: pixels * pixels * 4),
      count: pixels * pixels * 4)
    let painted = stride(from: 3, to: bytes.count, by: 4).contains { bytes[$0] > 0 }
    return painted ? context.makeImage() : nil
  }

  // MARK: WKNavigationDelegate

  /// Only the page itself loads; the `data:` image is a subresource, not a navigation.
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
  ) async -> WKNavigationActionPolicy {
    navigationAction.targetFrame?.isMainFrame == true
      && navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finishLoad(with: nil)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error)
  {
    finishLoad(with: error)
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: any Error
  ) {
    finishLoad(with: error)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    finishLoad(with: LoadFailed())
    tearDown()
  }
}
