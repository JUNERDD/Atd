import AICore
import AppKit

/// One generative view's window: the whole interactive view, which the user opens from its widget
/// in the conversation. Its renderer page (`#view?task=…&call=…`) frames the view's window
/// document below its own 52px header, which carries the view's title on the transparent 52pt
/// unified title bar (``UnifiedTitleBar``).
///
/// Clear and non-opaque, the window stands on the computer-use monitor's background
/// (``ComputerMonitorBackground``): the titled-window glass pinned to the app's scheme under the
/// panel's translucent base fill, both drawn natively, so the page paints no fill. The material
/// owns the clipping, edge and shadow. No full screen: glass over a full-screen Space has nothing
/// behind it. The frame is never remembered; closing releases the window and its page.
final class ViewWindowController: NSObject, NSWindowDelegate {
  /// The size a view that names none opens at, and the smallest the window resizes to, title bar
  /// included (`VIEW_WINDOW_DEFAULT_*` and `VIEW_WINDOW_MIN_*` in views.ts); the work area caps
  /// both.
  static let defaultSize = WindowSize(width: 560, height: 640)
  static let minimumSize = WindowSize(width: 320, height: 240)

  /// The view's window document, which identifies the window.
  let view: ViewDocument
  let host: WebViewHost
  private let window: NSWindow
  /// Owns the window's content view and keeps its fill current.
  private let background: ComputerMonitorBackground
  /// Runs once the window closed and its page is down.
  var onClose: (() -> Void)?

  /// Builds the window, places it and loads its page; ``show()`` brings it in. `last` is the
  /// frame of the view window opened last, from which this one cascades, if one is still open.
  init(
    view: ViewDocument, host: WebViewHost, title: String, size: WindowSize,
    cascadingFrom last: ScreenRect?
  ) {
    self.view = view
    self.host = host
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: size.width, height: size.height),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    background = ComputerMonitorBackground(content: host.container)
    super.init()
    window.title = title
    UnifiedTitleBar.apply(to: window, identifier: "view.titleBar")
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.collectionBehavior = [.fullScreenNone]
    window.contentView = background.view
    window.delegate = self
    place(size: size, cascadingFrom: last)
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
    host.load()
  }

  var isKey: Bool { window.isKeyWindow }
  var frame: ScreenRect { ScreenRect(window.frame) }

  func show() {
    NSApp.activate()
    if window.isMiniaturized { window.deminiaturize(nil) }
    window.makeKeyAndOrderFront(nil)
  }

  func windowWillClose(_ notification: Notification) {
    NotificationCenter.default.removeObserver(self)
    host.close()
    window.contentView = nil
    window.delegate = nil
    onClose?()
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: false)))
  }

  /// The first window opens centered in the work area under the pointer; a later one one AppKit
  /// cascade step (``NSWindow/cascadeTopLeft(from:)``) down and right of `last`, in the work area
  /// of `last`'s display. Either way it takes the size the view asks for as far as that work area
  /// allows, and stays inside it.
  private func place(size: WindowSize, cascadingFrom last: ScreenRect?) {
    let workArea = last.map(Screens.workArea(containing:)) ?? Screens.workAreaUnderCursor()
    var frame = ScreenRect(
      x: workArea.x + ((workArea.width - size.width) / 2).rounded(.down),
      y: workArea.y + ((workArea.height - size.height) / 2).rounded(.down),
      width: size.width, height: size.height)
    if let last {
      // Put on the last window's top-left corner, the window returns the next cascade point.
      let topLeft = window.cascadeTopLeft(from: NSPoint(x: last.x, y: last.maxY))
      frame.x = topLeft.x
      frame.y = topLeft.y - size.height
    }
    window.setFrame(NSRect(PanelGeometry.constrain(frame, to: workArea)), display: false)
    applyMinimumSize(workArea)
  }

  /// Keeps the window reachable when its display shrinks or disappears.
  @objc private func screensChanged() {
    guard !window.isZoomed else { return }
    let frame = ScreenRect(window.frame)
    let workArea = Screens.workArea(containing: frame)
    applyMinimumSize(workArea)
    let next = PanelGeometry.constrain(frame, to: workArea)
    if next != frame { window.setFrame(NSRect(next), display: true) }
  }

  private func applyMinimumSize(_ workArea: ScreenRect) {
    window.minSize = NSSize(
      width: min(Self.minimumSize.width, workArea.width),
      height: min(Self.minimumSize.height, workArea.height))
  }
}
