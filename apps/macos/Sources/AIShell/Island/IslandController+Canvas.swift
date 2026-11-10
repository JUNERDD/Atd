import AICore
import AppKit
import SwiftUI

/// The transparent drawing room, reserved before recording enters and held until the island
/// hides. Resizing an NSWindow while its erased glass outline animates changes the outline's
/// coordinate system independently of the content's transform. A shell card growing (an answer
/// arriving) therefore only changes the shape inside this fixed canvas, just as command
/// transitions do.
extension IslandController {
  /// The canvas large enough for a shape of `size` as well as what it holds now.
  func growCanvas(for size: WindowSize) {
    let grown = IslandMetrics.canvas(model.canvas, IslandMetrics.canvas(fitting: size))
    guard grown != model.canvas else { return }
    setCanvas(grown)
  }

  /// The island left: the next one starts on the default canvas.
  func resetCanvas() {
    guard model.canvas != IslandMetrics.canvas else { return }
    setCanvas(IslandMetrics.canvas)
  }

  /// The largest room the island may take on the display it stands on: its whole work area
  /// inside the HUDs' margin, wherever the island stands on it. A shape taller than the room
  /// above the island's bottom edge (the capsule was dragged up) moves that edge down as it
  /// morphs (``clamped(_:size:)``), rather than being cut to the room left above it.
  func screenRoom() -> WindowSize {
    let point = anchor ?? NSEvent.mouseLocation
    let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return IslandMetrics.maxShape }
    let margin = SelectionToolbarPlacement.margin
    return WindowSize(
      width: max(visible.width - margin * 2, 1), height: max(visible.height - margin * 2, 1))
  }

  /// Sets the canvas and the window's frame in one pass, so the frame drawn next has both.
  private func setCanvas(_ canvas: WindowSize) {
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      model.canvas = canvas
      guard window.isVisible, let anchor else { return }
      let frame = NSRect(
        x: anchor.x - canvas.width / 2, y: anchor.y - IslandMetrics.inset, width: canvas.width,
        height: canvas.height)
      window.setFrame(frame, display: false)
      window.contentView?.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
    }
  }
}
