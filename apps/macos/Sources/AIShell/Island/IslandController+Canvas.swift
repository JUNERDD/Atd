import AICore
import AppKit
import SwiftUI

/// The transparent drawing room, sized for the island's current shape and expanded only while a
/// shell card is actively streaming an answer so resizing the NSWindow never shifts the outline's
/// coordinate system mid-morph. Once settled, the canvas shrinks back to fit the active shape so
/// idle/hovered cards do not carry a display-sized transparent backing store.
extension IslandController {
  /// The size the canvas should fit for `next` at measured `target`.
  func canvasTarget(_ next: IslandContent, target: WindowSize) -> WindowSize {
    let floor: Double? =
      switch next.kind {
      case .recordingResult:
        model.recordingCard?.asking.answers.shown?.phase.running == true
          ? model.recordingCard?.asking.answerFloor ?? 0
          : nil
      case .longScreenshotResult:
        model.longScreenshotCard?.asking.answers.shown?.phase.running == true
          ? model.longScreenshotCard?.asking.answerFloor ?? 0
          : nil
      default: nil
      }
    guard let floor else { return target }
    let remaining = max(IslandMetrics.recordingAnswerCap - floor, 0)
    guard remaining > 0 else { return target }
    let room = screenRoom()
    return WindowSize(width: target.width, height: min(room.height, target.height + remaining))
  }

  /// Whether a shell card is still streaming an answer, so the canvas holds its answer headroom.
  var isShellAnswerStreaming: Bool {
    model.recordingCard?.asking.answers.shown?.phase.running == true
      || model.longScreenshotCard?.asking.answers.shown?.phase.running == true
  }

  /// Clamps an already-visible island's anchor for `target` before growing the canvas so `morph`
  /// does not issue a duplicate `setFrame` flush on the same show pass.
  func prepareCanvasAndAnchor(for next: IslandContent, target: WindowSize) {
    if window.isVisible, !exiting, let current = anchor {
      let adjusted = clamped(current, size: target)
      if adjusted != current {
        anchor = adjusted
        if !growCanvas(for: canvasTarget(next, target: target)) { placeWindow() }
        return
      }
    }
    growCanvas(for: canvasTarget(next, target: target))
  }

  /// The canvas large enough for a shape of `size` as well as what it holds now. Returns whether
  /// the canvas (and visible window frame) changed.
  @discardableResult
  func growCanvas(for size: WindowSize) -> Bool {
    let grown = IslandMetrics.canvas(model.canvas, IslandMetrics.canvas(fitting: size))
    guard grown != model.canvas else { return false }
    setCanvas(grown)
    return true
  }

  /// Shrinks the canvas back to fit `size` once any morph has settled.
  func fitCanvas(to size: WindowSize) {
    let fitted = IslandMetrics.canvas(fitting: size)
    guard fitted != model.canvas else { return }
    setCanvas(fitted)
  }

  /// The island left: the next one starts on the default canvas with no lingering animation.
  func clearPresentedState() {
    withoutAnimation {
      model.layers = []
      model.layoutMotion = .fixed
      model.shape.animation = nil
      resetCanvas()
    }
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
    withoutAnimation {
      model.canvas = canvas
      guard window.isVisible, let anchor else { return }
      window.setFrame(windowFrame(canvas, anchor: anchor), display: false)
    }
  }
}
