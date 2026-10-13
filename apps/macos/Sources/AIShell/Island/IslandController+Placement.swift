import AICore
import AppKit

/// Where the island stands (``GlassHUDPlacement``), its grip's drag, and its window.
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

  func drag(_ drag: IslandDrag) {
    switch drag {
    case .began:
      if let anchor { dragStart = (NSEvent.mouseLocation, anchor) }
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
    case .reset:
      dragStart = nil
      guard let size else { return }
      anchor = clamped(home(size), size: size)
      placeWindow(animate: true)
    }
  }

  func placeWindow(animate: Bool = false) {
    guard let anchor else { return }
    let canvas = IslandMetrics.canvas
    let frame = NSRect(
      x: anchor.x - canvas.width / 2, y: anchor.y - IslandMetrics.inset, width: canvas.width,
      height: canvas.height)
    window.setFrame(frame, display: true, animate: animate)
  }

  /// The shape's bottom centre at home for a shape of `size`.
  func home(_ size: WindowSize) -> NSPoint {
    let origin = GlassHUDPlacement.home(
      size: size, pointer: NSEvent.mouseLocation, displays: Self.displays(NSScreen.screens),
      fallback: Self.displays([NSScreen.main]).first)
    return NSPoint(x: origin.x + size.width / 2, y: origin.y)
  }

  /// `anchor` moved so a shape of `size` standing on it stays inside the work area.
  func clamped(_ anchor: NSPoint, size: WindowSize) -> NSPoint {
    let placed = GlassHUDPlacement.clamped(
      ScreenRect(
        x: anchor.x - size.width / 2, y: anchor.y, width: size.width, height: size.height),
      displays: Self.displays(NSScreen.screens), fallback: Self.displays([NSScreen.main]).first)
    return NSPoint(x: placed.x + placed.width / 2, y: placed.y)
  }

  private static func displays(_ screens: [NSScreen?]) -> [GlassHUDPlacement.Display] {
    screens.compactMap { screen in
      screen.map { .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame)) }
    }
  }

  // MARK: NSWindowDelegate

  func windowDidBecomeKey(_ notification: Notification) { model.cardIsKey = true }

  func windowDidResignKey(_ notification: Notification) {
    model.cardIsKey = false
    onResignKey?()
  }
}
