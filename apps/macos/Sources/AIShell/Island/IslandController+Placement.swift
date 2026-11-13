import AICore
import AppKit

/// Where the island stands (``GlassHUDPlacement``), its move handles' drag, and its window.
extension IslandController {
  /// Fades the window to `alpha`, then runs `completion` on the main actor.
  func fade(
    to alpha: Double, duration: Double, timing: CAMediaTimingFunctionName,
    completion: (@MainActor () -> Void)? = nil
  ) {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = duration
      context.timingFunction = CAMediaTimingFunction(name: timing)
      self.window.animator().alphaValue = alpha
    } completionHandler: {
      MainActor.assumeIsolated { completion?() }
    }
  }

  func makeWindow() -> IslandWindow {
    let window = IslandWindow(content: IslandHostingView(rootView: IslandView(model: model)))
    window.delegate = self
    window.onKeyDown = { [weak self] event in self?.onKeyDown?(event) ?? false }
    window.onKeyEquivalent = { [weak self] event in self?.onKeyEquivalent?(event) ?? false }
    window.onScroll = { [weak self] event in self?.onScroll?(event) ?? false }
    return window
  }

  /// Pre-creates the panel and runs an initial off-screen layout pass so the first command
  /// appearance avoids cold `NSHostingView` and glass surface setup.
  func warmUp() {
    _ = window
    window.contentView?.layoutSubtreeIfNeeded()
  }

  func drag(_ drag: IslandDrag) {
    switch drag {
    case .began:
      if let anchor {
        dragStart = (NSEvent.mouseLocation, anchor)
        window.pointerHover.beginDrag(in: window)
      }
    case .moved:
      guard let start = dragStart, let size else { return }
      let mouse = NSEvent.mouseLocation
      anchor = clamped(
        NSPoint(
          x: start.anchor.x + mouse.x - start.mouse.x, y: start.anchor.y + mouse.y - start.mouse.y),
        size: size)
      placeWindow()
    case .ended:
      dragStart = nil
      window.pointerHover.endDrag()
    case .reset:
      dragStart = nil
      window.pointerHover.endDrag()
      guard let size else { return }
      anchor = clamped(home(size), size: size)
      placeWindow(animate: true)
    }
  }

  func placeWindow(animate: Bool = false) {
    guard let anchor else { return }
    window.setFrame(windowFrame(model.canvas, anchor: anchor), display: animate, animate: animate)
  }

  /// The window's frame for a canvas of `canvas` around `anchor`
  /// (``IslandMetrics/windowOrigin(_:anchor:)``): on whole points, as the anchor is.
  func windowFrame(_ canvas: WindowSize, anchor: NSPoint) -> NSRect {
    NSRect(
      origin: IslandMetrics.windowOrigin(canvas, anchor: anchor),
      size: NSSize(width: canvas.width, height: canvas.height))
  }

  /// The shape's bottom centre at home for a shape of `size`.
  func home(_ size: WindowSize) -> NSPoint {
    let origin = GlassHUDPlacement.home(
      size: size, pointer: NSEvent.mouseLocation, displays: Self.displays(NSScreen.screens),
      fallback: Self.displays([NSScreen.main]).first)
    return NSPoint(x: origin.x + size.width / 2, y: origin.y)
  }

  /// `anchor` moved so a shape of `size` standing on it stays inside the work area, and onto whole
  /// points, so the window and the shapes resting in it stand on them (``IslandMetrics/rest(_:)``)
  /// wherever home, a drag or a morph puts it.
  func clamped(_ anchor: NSPoint, size: WindowSize) -> NSPoint {
    let placed = GlassHUDPlacement.clamped(
      ScreenRect(
        x: anchor.x - size.width / 2, y: anchor.y, width: size.width, height: size.height),
      displays: Self.displays(NSScreen.screens), fallback: Self.displays([NSScreen.main]).first)
    return NSPoint(x: (placed.x + placed.width / 2).rounded(), y: placed.y.rounded())
  }

  private static func displays(_ screens: [NSScreen?]) -> [GlassHUDPlacement.Display] {
    screens.compactMap { screen in
      screen.map { .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame)) }
    }
  }

  /// Takes the keyboard for a card once its shortcut is released (``KeyboardHandoff``),
  /// or returns it when the card gives it up (``NSPanel/returnKeyboard()``), keeping the island's
  /// exit or replacement visible. A card that is not `taking` the keyboard leaves it where it is:
  /// it takes it on a click.
  func setKeyCapable(_ capable: Bool, taking: Bool = true) {
    window.keyCapable = capable
    if capable, taking, window.isVisible, !window.isKeyWindow {
      keyboardTake.perform { [weak self] in
        guard let self, window.keyCapable, window.isVisible else { return }
        window.makeKey()
      }
    } else {
      keyboardTake.cancel()
      if !capable { window.returnKeyboard() }
    }
  }

  // MARK: NSWindowDelegate

  func windowDidBecomeKey(_ notification: Notification) { model.cardIsKey = true }

  func windowDidResignKey(_ notification: Notification) {
    model.cardIsKey = false
    onResignKey?()
  }
}
