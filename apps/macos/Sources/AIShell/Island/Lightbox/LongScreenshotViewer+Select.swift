import AICore
import AppKit

/// A marquee's drag over the image in text mode. It is anchored where the press went down, in
/// image points, so the box stays on that row wherever the image scrolls under the pointer, and
/// it is a click until the pointer has travelled ``LongScreenshotViewerPan/threshold``.
struct LongScreenshotViewerMarquee {
  /// Where the press went down (image points).
  let anchor: CGPoint
  /// Where the press went down, and the pointer now (window points).
  let start: NSPoint
  var pointer: NSPoint
  /// ⌘ or ⇧ was held at the press: the box adds to the picks rather than replacing them.
  let adding: Bool
  /// The press has dragged.
  var moved = false
  /// Scrolls the image while the pointer stays near the visible region's edges.
  let timer: Timer
}

/// Picking the long screenshot's text in its viewer (the plan's 「长截图的全屏预览」): a press is
/// the image's in view mode (it drags it, ``LongScreenshotViewer+Pan``) and the marquee's in text
/// mode, unless Space is held, which drags the image there too. A press that never travels is a
/// click either way: it picks the paragraph under it (``onPick``). The marquee picks what it
/// touches as it grows (``LongScreenshotTextModel/updateMarquee(_:adding:)``); near the visible
/// region's top, or the text command row, the image scrolls by itself, faster the deeper the
/// pointer goes (``LongScreenshotLightboxLayout/marqueeAutoscroll(pointer:)``), and a scroll of
/// the wheel or the trackpad mid-drag extends the box too (``sync()``).
extension LongScreenshotViewer {
  // MARK: Presses

  func press(_ event: NSEvent) {
    if mode == .text, !panKeyHeld { return beginMarquee(event) }
    beginPan(event)
  }

  func drag(_ event: NSEvent) {
    if marquee != nil { return dragMarquee(event) }
    dragPan(event)
  }

  func release(_ event: NSEvent) {
    if marquee != nil { return endMarquee(event) }
    endPan(event)
  }

  // MARK: The pointer

  /// The pointer over the image at rest: the marquee's crosshair in text mode, else the open
  /// hand of a press that drags.
  var restingPointer: PointerRole { mode == .text && !panKeyHeld ? .marquee : .grab }

  /// The pointer moved over the image (image points): the page under it in view mode, the
  /// paragraph under it in text mode, which shows the I-beam, or the pointing hand over what opens
  /// a result card (``opensCard``).
  func pointerMoved(to point: CGPoint) {
    guard mode == .text else { return card.hoverPreview(at: point.y) }
    let index = panKeyHeld || marquee != nil ? nil : text.paragraph(at: point)
    text.hover(index)
    guard pan == nil, marquee == nil else { return }
    document.hover.pointer =
      !panKeyHeld && opensCard(point) ? .action : index == nil ? restingPointer : .text
  }

  func pointerLeft() {
    card.hoverPreview(at: nil)
    text.hover(nil)
  }

  /// Space went down (`held`) or up in text mode: while it is held a press drags the image.
  func setPanKey(_ held: Bool) {
    guard panKeyHeld != held else { return }
    panKeyHeld = held
    if held { text.hover(nil) }
    if pan == nil, marquee == nil { document.hover.pointer = restingPointer }
  }

  /// The mode changed: a drag in progress ends, and the pointer and the hover start over.
  func modeChanged() {
    cancelMarquee()
    stopPan()
    panKeyHeld = false
    text.hover(nil)
    if mode != .view { card.hoverPreview(at: nil) }
    document.hover.pointer = restingPointer
  }

  // MARK: The marquee

  private func beginMarquee(_ event: NSEvent) {
    stopGlide()
    card.focusedHandle = nil
    guard trim == nil, marquee == nil else { return }
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.stepMarquee() }
    }
    RunLoop.main.add(timer, forMode: .common)
    let point = event.locationInWindow
    marquee = LongScreenshotViewerMarquee(
      anchor: document.convert(point, from: nil), start: point, pointer: point,
      adding: !event.modifierFlags.isDisjoint(with: [.command, .shift]), timer: timer)
  }

  private func dragMarquee(_ event: NSEvent) {
    guard var current = marquee else { return }
    let point = event.locationInWindow
    current.pointer = point
    if !current.moved {
      let travel = hypot(point.x - current.start.x, point.y - current.start.y)
      guard travel >= LongScreenshotViewerPan.threshold else {
        marquee = current
        return
      }
      current.moved = true
      text.hover(nil)
      text.beginMarquee()
    }
    marquee = current
    updateMarquee()
    // The drag owns its cursor until release, wherever the pointer goes.
    PointerRole.marquee.cursor.set()
  }

  /// One frame of the drag: the autoscroll, whose scroll re-projects the box (``sync()``), or
  /// else the box itself.
  private func stepMarquee() {
    guard let current = marquee, current.moved else { return }
    let step = viewport.layout.marqueeAutoscroll(
      pointer: overlay.convert(current.pointer, from: nil).y)
    if step != 0 { scroll(by: step) } else { updateMarquee() }
    PointerRole.marquee.cursor.set()
  }

  /// The box from its anchor to the image point under the pointer, as the image stands now.
  func updateMarquee() {
    guard let current = marquee, current.moved else { return }
    let point = document.convert(current.pointer, from: nil)
    let rect = CGRect(
      x: min(current.anchor.x, point.x), y: min(current.anchor.y, point.y),
      width: abs(point.x - current.anchor.x), height: abs(point.y - current.anchor.y))
    text.updateMarquee(rect, adding: current.adding)
    picks.badge = picks.convert(current.pointer, from: nil)
  }

  /// The press was let go: a marquee keeps its picks; a press that never travelled is a click.
  private func endMarquee(_ event: NSEvent) {
    guard let current = marquee else { return }
    current.timer.invalidate()
    marquee = nil
    picks.badge = nil
    document.hover.pointer = restingPointer
    if current.moved {
      text.endMarquee()
    } else {
      onPick(document.convert(event.locationInWindow, from: nil), event.modifierFlags)
    }
  }

  /// Escape mid-drag, or the viewer going: the picks go back to what they were before it. False
  /// without a marquee.
  @discardableResult
  func cancelMarquee() -> Bool {
    guard let current = marquee else { return false }
    current.timer.invalidate()
    marquee = nil
    picks.badge = nil
    document.hover.pointer = restingPointer
    if current.moved { text.endMarquee(cancel: true) }
    return true
  }
}
