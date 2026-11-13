import AICore
import AppKit
import QuartzCore
import WebKit

/// The single settings window: glass background, a transparent 52pt unified title bar with the
/// standard traffic lights, and its own renderer web view (loaded at `#settings`). Closing
/// releases the window and its web view; opening again builds a fresh one.
///
/// The title bar is `UnifiedTitleBar`; the page lays its sidebar strip and content header out on
/// that 52pt bar (`settings.css`).
final class SettingsWindowController: NSObject, NSWindowDelegate {
  private var window: NSWindow?
  private(set) var host: WebViewHost?
  private var loadingView: SettingsLoadingView?
  private var revealing = false
  private var revealTask: Task<Void, Never>?
  private let makeHost: (_ fragment: String) -> WebViewHost
  /// Runs after the window is created or released, before an opened window activates the app.
  /// On close, supplies the departing window while AppKit may still consider it key.
  var onOpenChange: ((_ closingWindow: NSWindow?) -> Void)?

  init(makeHost: @escaping (_ fragment: String) -> WebViewHost) {
    self.makeHost = makeHost
    super.init()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  isolated deinit { revealTask?.cancel() }

  var isKey: Bool { window?.isKeyWindow == true }
  var isOpen: Bool { window != nil }

  /// Shows the window, creating it on the display under the cursor when none is open. An open
  /// window keeps its page; `fragment` applies to a new one only.
  func open(fragment: String = "settings", title: String) {
    if let window {
      NSApp.activate()
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
      return
    }
    let workArea = Screens.workAreaUnderCursor()
    let window = NSWindow(
      contentRect: NSRect(SettingsGeometry.centeredFrame(in: workArea)),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    let host = makeHost(fragment)
    window.title = title
    UnifiedTitleBar.apply(to: window, identifier: "settings.titleBar")
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.fullScreenNone]
    let stage = NSView()
    stage.wantsLayer = true
    host.container.wantsLayer = true
    host.container.alphaValue = 0
    host.container.frame = stage.bounds
    host.container.autoresizingMask = [.width, .height]
    let loading = SettingsLoadingView(frame: stage.bounds)
    loading.autoresizingMask = [.width, .height]
    stage.addSubview(host.container)
    stage.addSubview(loading)
    window.contentView = GlassBackground.make(content: stage)
    window.delegate = self
    applyMinimumSize(workArea, to: window)
    self.window = window
    self.host = host
    self.loadingView = loading
    self.revealing = false
    host.onDragRegionsReady = { [weak self] in self?.scheduleReveal() }
    revealTask?.cancel()
    revealTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(5))
      guard !Task.isCancelled else { return }
      self?.revealPage()
    }
    onOpenChange?(nil)
    host.load()
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
  }

  private func scheduleReveal() {
    guard loadingView != nil, !revealing, let webView = host?.webView else { return }
    revealing = true
    host?.onDragRegionsReady = nil
    webView.callAsyncJavaScript(
      "await new Promise((resolve) => requestAnimationFrame(() => resolve()))",
      in: nil, in: .page
    ) { [weak self, weak webView] _ in
      MainActor.assumeIsolated {
        guard let self, let webView else { return }
        if self.host?.webView === webView {
          self.revealPage()
        } else {
          self.revealing = false
          self.host?.onDragRegionsReady = { [weak self] in self?.scheduleReveal() }
        }
      }
    }
  }

  private func revealPage() {
    guard let loadingView else { return }
    self.loadingView = nil
    revealing = false
    revealTask?.cancel()
    revealTask = nil
    host?.onDragRegionsReady = nil
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 1
    loadingView.stop()
    loadingView.removeFromSuperview()
    CATransaction.commit()
    if let window, window.isKeyWindow, let webView = host?.webView,
      window.firstResponder === window || window.firstResponder == nil
    {
      window.makeFirstResponder(webView)
    }
  }

  /// Makes an open window key again unless it is hidden or miniaturized; false when there is
  /// none to focus.
  func focusIfShown() -> Bool {
    guard let window, window.isVisible, !window.isMiniaturized else { return false }
    window.makeKeyAndOrderFront(nil)
    return true
  }

  /// The page a new window opens: `commandId`'s editor (`settings?commandId=…`), otherwise
  /// `section` (`settings?section=…`), otherwise the default page.
  static func fragment(commandId: String?, section: String?) -> String {
    let item =
      commandId.map { URLQueryItem(name: "commandId", value: $0) }
      ?? section.map { URLQueryItem(name: "section", value: $0) }
    guard let item else { return "settings" }
    var query = URLComponents()
    query.queryItems = [item]
    // `URLSearchParams` reads `+` as a space.
    let encoded = query.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return "settings?" + (encoded ?? "")
  }

  func setTitle(_ title: String) { window?.title = title }

  func close() { window?.close() }

  func windowWillClose(_ notification: Notification) {
    revealTask?.cancel()
    revealTask = nil
    revealing = false
    loadingView?.stop()
    loadingView = nil
    host?.onDragRegionsReady = nil
    let closingWindow = window
    host?.close()
    host = nil
    window?.delegate = nil
    window = nil
    onOpenChange?(closingWindow)
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host?.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    host?.setState(.windowActive(.init(active: false)))
  }

  /// Keeps the window reachable when its display shrinks or disappears.
  @objc private func screensChanged() {
    guard let window, !window.isZoomed else { return }
    let frame = ScreenRect(window.frame)
    let workArea = Screens.workArea(containing: frame)
    applyMinimumSize(workArea, to: window)
    let next = PanelGeometry.constrain(frame, to: workArea)
    if next != frame { window.setFrame(NSRect(next), display: true) }
  }

  private func applyMinimumSize(_ workArea: ScreenRect, to window: NSWindow) {
    let minimum = SettingsGeometry.minimumSize(in: workArea)
    window.minSize = NSSize(width: minimum.width, height: minimum.height)
  }
}
