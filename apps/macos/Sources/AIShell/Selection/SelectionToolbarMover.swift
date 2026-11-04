import AICore
import AppKit

/// Moves the selection toolbar's window when its grip or capsule surface is dragged
/// (``AnnotationGlassBar/Drag``), like the capture toolbar: the capsule stays where it is
/// dropped, inside the work area of the display under it, until the toolbar hides; a double-click
/// puts it back where it was placed beside the selection (``placed``). The `click` mode's small
/// icon moves the same way; its ``placed`` is where it came up, which the toolbar it grows into
/// measures the drag from.
@MainActor
final class SelectionToolbarMover {
  /// The window frame that put the capsule beside the selection; a double-click returns it.
  var placed: NSRect?

  private let window: NSWindow
  /// The transparent margin between the window's edge and the capsule.
  private let inset: CGFloat
  /// The window's origin when the current drag began.
  private var dragOrigin: NSPoint?

  init(window: NSWindow, inset: CGFloat) {
    self.window = window
    self.inset = inset
  }

  func handle(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began:
      dragOrigin = window.frame.origin
    case .moved(let travel):
      guard let dragOrigin else { return }
      var capsule = window.frame.insetBy(dx: inset, dy: inset)
      capsule.origin = NSPoint(
        x: dragOrigin.x + inset + travel.dx, y: dragOrigin.y + inset - travel.dy)
      let origin = clamped(capsule).origin
      window.setFrameOrigin(NSPoint(x: origin.x - inset, y: origin.y - inset))
    case .reset:
      dragOrigin = nil
      if let placed { window.setFrame(placed, display: true, animate: true) }
    }
  }

  /// The toolbar hid: the placement and any drag in progress no longer apply.
  func reset() {
    placed = nil
    dragOrigin = nil
  }

  /// The capsule's `frame` kept ``SelectionToolbarPlacement/margin`` inside the work area of
  /// the display that holds most of it.
  private func clamped(_ frame: NSRect) -> NSRect {
    let screen =
      NSScreen.screens.max {
        $0.frame.intersection(frame).area < $1.frame.intersection(frame).area
      } ?? window.screen
    guard
      let area = screen?.visibleFrame.insetBy(
        dx: SelectionToolbarPlacement.margin, dy: SelectionToolbarPlacement.margin)
    else { return frame }
    var result = frame
    result.origin.x = min(max(frame.minX, area.minX), area.maxX - frame.width)
    result.origin.y = min(max(frame.minY, area.minY), area.maxY - frame.height)
    return result
  }
}

extension NSRect {
  fileprivate var area: CGFloat { isNull ? 0 : width * height }
}
