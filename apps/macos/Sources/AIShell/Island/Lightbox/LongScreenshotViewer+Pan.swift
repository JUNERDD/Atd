import AICore
import AppKit

/// A press on the image in view mode, which becomes a drag once the pointer has travelled
/// ``threshold``: until then it is a click, so a click stays one.
struct LongScreenshotViewerPan {
  /// How far the pointer travels before a press drags (screen points).
  static let threshold = 3.0
  /// How much of the drag's end measures the release's velocity (seconds).
  static let window = 0.08
  /// A pointer held still this long before the release lets the image go without a glide
  /// (seconds).
  static let rest = 0.05

  /// Where the press went down (window points).
  let start: NSPoint
  /// The pointer's last position (window points).
  var last: NSPoint
  /// The press has dragged.
  var moved = false
  /// The pointer's positions over the last ``window``, with their times.
  var samples: [(time: TimeInterval, point: NSPoint)]

  /// The pointer's velocity at the release at `time` (screen points per second, window axes),
  /// or nil when it had come to rest.
  func velocity(at time: TimeInterval) -> CGVector? {
    guard let first = samples.first, let last = samples.last, time - last.time < Self.rest
    else { return nil }
    let span = last.time - first.time
    guard span > 0.005 else { return nil }
    return CGVector(
      dx: (last.point.x - first.point.x) / span, dy: (last.point.y - first.point.y) / span)
  }
}

/// A flick's glide: the image keeps the release's velocity and slows down frame by frame, as a
/// trackpad's scroll does, until it is slow or reaches its limits.
struct LongScreenshotViewerGlide {
  /// The velocity kept per millisecond, as a scroll view's normal deceleration.
  static let deceleration = 0.998
  /// A release slower than this lets the image go where it is (screen points per second).
  static let minimumSpeed = 120.0
  /// The glide ends below this (screen points per second).
  static let stopSpeed = 12.0

  var velocity: CGVector
  var time: CFTimeInterval
  let timer: Timer
}

/// Dragging the image (the long screenshot lightbox's view mode, and text mode with Space held):
/// the image follows the pointer, as the rail's viewport does there, across and along at any
/// zoom within the scroller's limits, and a flick lets it glide on. The pointer is an open hand
/// over the image and a closed one from the press to the release, as on the rail
/// (``LongScreenshotViewerDocument/hover``). Annotate mode leaves every drag to the canvas; a
/// trim bar's drag wins over the image under it. A press that never travels is a click, which
/// picks the paragraph under it (``onPick``). Anything else that moves the image (a scroll, a
/// pinch, a key, the rail, a button) stops a glide.
extension LongScreenshotViewer {
  /// The image was pressed: a glide stops, a focused trim bar lets go, and the press may become
  /// a drag.
  func beginPan(_ event: NSEvent) {
    stopGlide()
    card.focusedHandle = nil
    guard mode != .annotate, trim == nil else { return }
    let point = event.locationInWindow
    pan = LongScreenshotViewerPan(
      start: point, last: point, samples: [(event.timestamp, point)])
    document.hover.pointer = .grabbing
    PointerRole.grabbing.cursor.set()
  }

  func dragPan(_ event: NSEvent) {
    guard var current = pan else { return }
    let point = event.locationInWindow
    if !current.moved {
      let travel = hypot(point.x - current.start.x, point.y - current.start.y)
      guard travel >= LongScreenshotViewerPan.threshold else { return }
      current.moved = true
    }
    let delta = CGVector(dx: point.x - current.last.x, dy: point.y - current.last.y)
    current.last = point
    current.samples.append((event.timestamp, point))
    current.samples.removeAll { event.timestamp - $0.time > LongScreenshotViewerPan.window }
    pan = current
    shift(by: delta)
    // The drag owns its cursor until release, wherever the pointer goes.
    PointerRole.grabbing.cursor.set()
  }

  /// The press was let go: a drag that was still moving glides on; one that never travelled is
  /// a click on the image.
  func endPan(_ event: NSEvent) {
    guard let current = pan else { return }
    pan = nil
    document.hover.pointer = restingPointer
    guard current.moved else {
      // Space held in text mode only moves the image.
      guard !panKeyHeld else { return }
      return onPick(document.convert(event.locationInWindow, from: nil), event.modifierFlags)
    }
    if let velocity = current.velocity(at: event.timestamp) { startGlide(velocity) }
  }

  /// The drag and the glide end with the viewer (hidden, closing, annotate mode).
  func stopPan() {
    if pan != nil { document.hover.pointer = restingPointer }
    pan = nil
    stopGlide()
  }

  func stopGlide() {
    glide?.timer.invalidate()
    glide = nil
  }

  private func startGlide(_ velocity: CGVector) {
    guard hypot(velocity.dx, velocity.dy) >= LongScreenshotViewerGlide.minimumSpeed else {
      return
    }
    let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.stepGlide() }
    }
    RunLoop.main.add(timer, forMode: .common)
    glide = LongScreenshotViewerGlide(
      velocity: velocity, time: CACurrentMediaTime(), timer: timer)
  }

  /// One frame of the glide: the image moves by the velocity over the frame, which then slows.
  private func stepGlide() {
    guard var current = glide else { return }
    let now = CACurrentMediaTime()
    // A late frame moves as far as one frame at most could have, not the whole gap.
    let elapsed = min(now - current.time, 0.05)
    current.time = now
    let keep = pow(LongScreenshotViewerGlide.deceleration, elapsed * 1000)
    current.velocity = CGVector(
      dx: current.velocity.dx * keep, dy: current.velocity.dy * keep)
    glide = current
    let moved = shift(
      by: CGVector(dx: current.velocity.dx * elapsed, dy: current.velocity.dy * elapsed))
    let speed = hypot(current.velocity.dx, current.velocity.dy)
    if !moved || speed < LongScreenshotViewerGlide.stopSpeed { stopGlide() }
  }

  /// Moves the image by `delta` on the screen (window axes, y up), as the pointer moves: false
  /// when its limits kept it where it was.
  @discardableResult
  private func shift(by delta: CGVector) -> Bool {
    let zoom = max(scroll.magnification, 0.0001)
    let origin = clip.bounds.origin
    // The document runs down while the window's y runs up.
    setOrigin(CGPoint(x: origin.x - delta.dx / zoom, y: origin.y + delta.dy / zoom))
    return clip.bounds.origin != origin
  }
}
