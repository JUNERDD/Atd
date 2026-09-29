import AICore
import AppKit

/// The single settings window: glass background, transparent title bar with the standard
/// traffic lights, and its own renderer web view (loaded at `#settings`). Closing releases the
/// window and its web view; opening again builds a fresh one.
@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
  private var window: NSWindow?
  private(set) var host: WebViewHost?
  private let makeHost: (_ fragment: String) -> WebViewHost

  init(makeHost: @escaping (_ fragment: String) -> WebViewHost) {
    self.makeHost = makeHost
    super.init()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  var isKey: Bool { window?.isKeyWindow == true }
  var isOpen: Bool { window != nil }

  /// Shows the window, creating it on the display under the cursor when none is open. An open
  /// window keeps its page; `fragment` applies to a new one only.
  func open(fragment: String = "settings", title: String) {
    NSApp.activate()
    if let window {
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
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.fullScreenNone]
    window.contentView = GlassBackground.make(content: host.container)
    window.delegate = self
    applyMinimumSize(workArea, to: window)
    self.window = window
    self.host = host
    host.load()
    window.makeKeyAndOrderFront(nil)
  }

  func setTitle(_ title: String) { window?.title = title }

  func close() { window?.close() }

  func windowWillClose(_ notification: Notification) {
    host?.close()
    host = nil
    window?.delegate = nil
    window = nil
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host?.setState(ShellEventName.windowActive, .bool(true))
  }

  func windowDidResignKey(_ notification: Notification) {
    host?.setState(ShellEventName.windowActive, .bool(false))
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
