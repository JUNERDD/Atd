import AppKit

/// Drags an app's pin out of a renderer window onto the desktop with a native drag session,
/// started from the press the page reported (``ShellWebView/lastMouseDown``), as WebKit starts
/// its own drags from a stored mouse-down.
///
/// The pasteboard holds only a private type with a marker, and the source allows no operation
/// outside Atd, so no other app (Finder included) can take the drop and no file is ever created.
/// Inside Atd only the drop catchers (``DesktopDropCatcher``) accept it, one per display over its
/// desktop, and only from this source: a drop there pins the app at that point, while Escape or
/// a drop on any window, the Dock or the menu bar slides the image back.
final class DesktopPinDrag: NSObject, NSDraggingSource {
  static let pasteboardType = NSPasteboard.PasteboardType("com.junerdd.ai.desktop-pin")

  /// A drop on the desktop: the app and the point, in AppKit's global coordinates.
  var onDrop: ((_ appId: String, _ point: NSPoint) -> Void)?

  private struct Session {
    let appId: String
    weak var webView: ShellWebView?
    var catchers: [DesktopDropCatcher] = []
    var drop: NSPoint?
  }
  private var session: Session?

  var isActive: Bool { session != nil }

  /// Starts dragging `image`, the pin as it will look, centered under the press. False while
  /// another drag runs.
  func start(appId: String, image: NSImage, press: NSEvent, from webView: ShellWebView) -> Bool {
    guard session == nil else { return false }
    let item = NSPasteboardItem()
    item.setString("pin", forType: Self.pasteboardType)
    let dragging = NSDraggingItem(pasteboardWriter: item)
    let point = webView.convert(press.locationInWindow, from: nil)
    let size = image.size
    dragging.setDraggingFrame(
      NSRect(
        x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width,
        height: size.height), contents: image)
    session = Session(appId: appId, webView: webView)
    let started = webView.beginDraggingSession(with: [dragging], event: press, source: self)
    started.animatesToStartingPositionsOnCancelOrFail = true
    started.draggingFormation = .none
    return true
  }

  /// A catcher took the drop at this global point.
  func caught(at point: NSPoint) {
    session?.drop = point
  }

  /// Whether a drag's source is this one.
  func isSource(of info: any NSDraggingInfo) -> Bool {
    session != nil && (info.draggingSource as AnyObject?) === self
  }

  // MARK: NSDraggingSource

  func draggingSession(
    _ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    context == .withinApplication ? .generic : []
  }

  func ignoreModifierKeys(for session: NSDraggingSession) -> Bool { true }

  func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) {
    self.session?.catchers = NSScreen.screens.map { DesktopDropCatcher(screen: $0, drag: self) }
  }

  func draggingSession(
    _ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation
  ) {
    guard let ended = self.session else { return }
    self.session = nil
    for catcher in ended.catchers { catcher.close() }
    ended.webView?.releasePress()
    if !operation.isEmpty, let drop = ended.drop { onDrop?(ended.appId, drop) }
  }
}

/// A transparent window over one display, at the pins' level and above them, that accepts the
/// drop of a pin drag from ``DesktopPinDrag`` only. Windows of every app, the Dock and the menu
/// bar sit above it, so a drop lands here only on visible desktop, as with system widgets. Its
/// background is not fully clear: the window server hands drags only to windows with pixels
/// under the pointer, and one 255th of black over the desktop cannot be seen.
final class DesktopDropCatcher: NSWindow {
  init(screen: NSScreen, drag: DesktopPinDrag) {
    super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    level = DesktopPinWindow.level
    collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
    isOpaque = false
    backgroundColor = NSColor(white: 0, alpha: 1 / 255)
    hasShadow = false
    ignoresMouseEvents = false
    isReleasedWhenClosed = false
    isExcludedFromWindowsMenu = true
    animationBehavior = .none
    let view = CatcherView(drag: drag)
    view.registerForDraggedTypes([DesktopPinDrag.pasteboardType])
    contentView = view
    setFrame(screen.frame, display: false)
    orderFrontRegardless()
  }

  /// A borderless window is otherwise kept below the menu bar.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}

private final class CatcherView: NSView {
  private weak var drag: DesktopPinDrag?

  init(drag: DesktopPinDrag) {
    self.drag = drag
    super.init(frame: .zero)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  private func operation(_ info: any NSDraggingInfo) -> NSDragOperation {
    drag?.isSource(of: info) == true ? .generic : []
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    operation(sender)
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    operation(sender)
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    !operation(sender).isEmpty
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard let drag, drag.isSource(of: sender), let window else { return false }
    drag.caught(at: window.convertPoint(toScreen: sender.draggingLocation))
    return true
  }
}
