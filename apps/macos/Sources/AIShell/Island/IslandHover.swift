import AppKit

/// The island's single pointer clock, used by every interactive layer while the window is
/// visible. Like the mini panel it sleeps away from its controls. Hover state changes only on
/// entry/exit; cursor ownership is maintained for as long as a control or drag needs it.
final class IslandPointerHover {
  let regions = FloatingHoverRegions()
  private let pointer = MiniPanelPointer()
  private let cursorHit = FloatingWindowHitTest()
  private var cursor: NSCursor?
  private weak var cursorWindow: NSWindow?
  private weak var dragWindow: IslandWindow?

  init() {
    regions.onFirstRegion = { [weak self] view in self?.pointer.start(in: view) }
    regions.onEmpty = { [weak self] in self?.stop() }
    pointer.onMove = { [weak self] point, _ in self?.update(point) }
    pointer.onFrame = { [weak self] _, _ in
      let point = NSEvent.mouseLocation
      self?.update(point)
    }
    pointer.isNear = { [weak self] point in self?.regions.isNear(point) == true }
    pointer.isBusy = { [weak self] in self?.dragWindow != nil }
  }

  /// Clamping the island to a display can leave the pointer outside the moving grip. The
  /// gesture, rather than the grip's hover bounds, owns the closed hand until release.
  func beginDrag(in window: IslandWindow) {
    dragWindow = window
    pointer.wake()
    update(NSEvent.mouseLocation)
  }

  func endDrag() {
    dragWindow = nil
    update(NSEvent.mouseLocation)
  }

  /// Re-evaluates pointer hover regions at the current cursor position once an entering or
  /// morphing island finishes settling and becomes hover-interactive.
  func refresh() {
    update(NSEvent.mouseLocation)
  }

  private func update(_ point: CGPoint) {
    if let window = dragWindow,
      !window.isVisible || !window.hoverInteractive || NSEvent.pressedMouseButtons & 1 == 0
    {
      dragWindow = nil
    }
    let hovered = regions.update(point, active: dragWindow == nil)
    let next = dragWindow == nil ? hovered : PointerRole.grabbing.cursor
    if next != nil { cursorWindow = dragWindow ?? regions.hoveredWindow }
    if let next {
      // Local monitors run before AppKit/SwiftUI dispatch, which can reset the cursor after
      // this update. Reassert while we own it: a cached desired cursor (even NSCursor.current
      // in this inactive app) does not establish what the window server is displaying.
      next.set()
    } else if cursor != nil {
      cursorHit.releaseCursor(from: cursorWindow)
      cursorWindow = nil
    }
    cursor = next
  }

  private func stop() {
    pointer.stop()
    if cursor != nil { cursorHit.releaseCursor(from: cursorWindow) }
    cursor = nil
    cursorWindow = nil
    dragWindow = nil
  }
}
