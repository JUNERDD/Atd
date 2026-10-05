import AICore
import AppKit

/// One user app's window, titled with the app's name, in the material its version asks for
/// (``UserAppRuntime/Surface``):
/// - glass: the settings window's recipe. The glass background (``GlassBackground``) owns the
///   clipping, edge, shadow and desktop blur; the transparent 52pt unified title bar
///   (``UnifiedTitleBar``) lies over the page, which paints the fill and lays its first row out on
///   the bar. The content view is the whole window, so the app's size includes that row. No full
///   screen: glass over a full-screen Space has nothing behind it.
/// - opaque: a standard titled, resizable, opaque window; the page paints its own surface below
///   the native title bar.
///
/// Its frame is remembered per app and kept inside the current work area. Closing releases the
/// window and its web view.
final class UserAppWindowController: NSObject, NSWindowDelegate {
  let host: UserAppHost
  private let window: NSWindow
  private let storage: UserAppStorage
  /// Runs once the window closed and its web view is down.
  var onClose: ((_ appId: String) -> Void)?

  init(host: UserAppHost, storage: UserAppStorage) {
    self.host = host
    self.storage = storage
    let runtime = host.runtime
    let glass = host.surface == .glass
    var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable]
    if glass { style.insert(.fullSizeContentView) }
    if let remembered = storage.frame(appId: host.appId) {
      let workArea = Screens.workArea(containing: remembered)
      window = NSWindow(contentRect: .zero, styleMask: style, backing: .buffered, defer: false)
      window.setFrame(
        NSRect(UserAppGeometry.frame(remembered: remembered, window: runtime.window, in: workArea)),
        display: false)
    } else {
      // The app's size is its content size: below an opaque window's title bar, which comes on
      // top, or the whole glass window. Then the frame is fitted into the work area.
      let workArea = Screens.workAreaUnderCursor()
      let content = UserAppGeometry.frame(remembered: nil, window: runtime.window, in: workArea)
      window = NSWindow(
        contentRect: NSRect(content), styleMask: style, backing: .buffered, defer: false)
      let fitted = PanelGeometry.constrain(ScreenRect(window.frame), to: workArea)
      window.setFrame(NSRect(fitted), display: false)
    }
    super.init()
    window.title = runtime.name
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    if glass {
      UnifiedTitleBar.apply(to: window, identifier: "userApp.titleBar")
      window.isOpaque = false
      window.backgroundColor = .clear
      window.hasShadow = true
      window.collectionBehavior = [.fullScreenNone]
      window.contentView = GlassBackground.make(content: host.container)
    } else {
      window.contentView = host.container
    }
    window.delegate = self
    applyMinimumSize()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  var isKey: Bool { window.isKeyWindow }

  func show() {
    NSApp.activate()
    if window.isMiniaturized { window.deminiaturize(nil) }
    window.makeKeyAndOrderFront(nil)
  }

  /// A newer runtime: the title follows the name, the page reloads on a new version.
  func update(_ runtime: UserAppRuntime) {
    window.title = runtime.name
    host.update(runtime)
    applyMinimumSize()
  }

  func close() { window.close() }

  func windowWillClose(_ notification: Notification) {
    remember()
    NotificationCenter.default.removeObserver(self)
    host.close()
    window.contentView = nil
    window.delegate = nil
    onClose?(host.appId)
  }

  func windowDidBecomeKey(_ notification: Notification) { host.setWindowActive(true) }

  func windowDidResignKey(_ notification: Notification) { host.setWindowActive(false) }

  func windowDidMove(_ notification: Notification) { remember() }

  func windowDidEndLiveResize(_ notification: Notification) { remember() }

  private func remember() {
    guard !window.isZoomed, !window.styleMask.contains(.fullScreen) else { return }
    storage.rememberFrame(ScreenRect(window.frame), appId: host.appId)
  }

  /// The app's minimum content size, never larger than the work area.
  private func applyMinimumSize() {
    let workArea = Screens.workArea(containing: ScreenRect(window.frame))
    let minimum = UserAppGeometry.minimumSize(host.runtime.window, in: workArea)
    window.contentMinSize = NSSize(width: minimum.width, height: minimum.height)
  }

  /// Keeps the window reachable when its display shrinks or disappears.
  @objc private func screensChanged() {
    guard !window.isZoomed, !window.styleMask.contains(.fullScreen) else { return }
    let frame = ScreenRect(window.frame)
    let next = PanelGeometry.constrain(frame, to: Screens.workArea(containing: frame))
    if next != frame { window.setFrame(NSRect(next), display: true) }
    applyMinimumSize()
  }
}
