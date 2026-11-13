import AICore
import AppKit

/// A trim bar's drag on the viewer: the bar follows the pointer wherever the image scrolls under
/// it, so its end of the kept range is always the image row under the pointer (less where on the
/// bar it was pressed). Near the visible region's edges the image scrolls by itself
/// (``LongScreenshotLightboxLayout/autoscroll(pointer:height:)``), on a timer, so holding the
/// pointer still there keeps scrolling.
struct LongScreenshotViewerTrim {
  let edge: LongScreenshotCardState.Edge
  /// The edge's row when pressed (image points), which the card's drag moves from.
  let start: CGFloat
  /// The pointer's distance below the bar's line when pressed (screen points).
  let grip: CGFloat
  /// The pointer's y in the overlay (screen points).
  var pointer: CGFloat
  /// The row last given to the card, so a still pointer changes nothing.
  var applied: CGFloat?
  let timer: Timer
}

extension LongScreenshotViewer {
  /// The overlay's trim bars drag the kept range here; VoiceOver nudges them.
  func wireTrim() {
    for bar in overlay.bars {
      let edge = bar.edge
      bar.onPress = { [weak self] in self?.beginTrim(edge, $0) }
      bar.onDrag = { [weak self] in self?.dragTrim($0) }
      bar.onRelease = { [weak self] in self?.endTrim() }
      bar.onAdjust = { [weak self] down in
        guard let self else { return }
        card.focusedHandle = edge
        _ = card.nudge(down: down, shift: false)
        overlay.refresh()
      }
    }
  }

  private func beginTrim(_ edge: LongScreenshotCardState.Edge, _ event: NSEvent) {
    guard trim == nil, mode == .view else { return }
    let kept = card.state.kept
    let start = edge == .top ? kept.top : kept.bottom
    let pointer = overlay.convert(event.locationInWindow, from: nil).y
    let image = overlay.convert(document.bounds, from: document)
    // A press alone moves nothing, wherever on the bar it lands.
    card.drag(edge, by: 0)
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.stepTrim() }
    }
    RunLoop.main.add(timer, forMode: .common)
    trim = LongScreenshotViewerTrim(
      edge: edge, start: start, grip: pointer - (image.minY + start * scroll.magnification),
      pointer: pointer, applied: start, timer: timer)
    viewport.trimming = true
    overlay.dragging = edge
    document.hover.enabled = false
    PointerRole.resizeRow.cursor.set()
  }

  private func dragTrim(_ event: NSEvent) {
    guard trim != nil else { return }
    trim?.pointer = overlay.convert(event.locationInWindow, from: nil).y
    stepTrim()
  }

  /// One frame of the drag: the autoscroll, then the edge to the row under the pointer.
  private func stepTrim() {
    guard let current = trim else { return }
    let step = viewport.layout.autoscroll(pointer: current.pointer, height: overlay.bounds.height)
    if step != 0 { scroll(by: step) }
    let image = overlay.convert(document.bounds, from: document)
    let row = (current.pointer - current.grip - image.minY) / max(scroll.magnification, 0.0001)
    // The drag owns its cursor until release, wherever the pointer goes.
    PointerRole.resizeRow.cursor.set()
    guard row != current.applied else { return }
    trim?.applied = row
    card.drag(current.edge, by: row - current.start)
    overlay.refresh()
  }

  /// The bar was let go, or the drag ends with the viewer (hidden, closing, annotate mode).
  func endTrim() {
    guard let current = trim else { return }
    current.timer.invalidate()
    trim = nil
    card.endDrag()
    viewport.trimming = false
    overlay.dragging = nil
    document.hover.enabled = mode != .annotate
  }
}
