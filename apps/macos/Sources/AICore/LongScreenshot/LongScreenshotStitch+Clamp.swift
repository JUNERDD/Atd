import CoreGraphics
import Foundation

/// Bottom-clamp verification and idle caret-blink suppression for ``LongScreenshotStitch``.
///
/// When the final downward step hits a sparse composer/footer margin (< 8 evidence rows) or a
/// blinking caret, the frame can fail translation matching even though the scroll view clamped at
/// its physical bottom. Rather than declaring `lost = .down`, the stitch arms a probe on that
/// unmatched frame, confirms stillness across a subsequent downward retest (`0.4s`), and converges
/// cleanly to `reachedEnd = true` without trimming valid stitched rows.
extension LongScreenshotStitch {
  struct ClampState: Sendable {
    var probe: (signature: LongScreenshotSignature, since: Double, retested: Bool)?
    var signature: LongScreenshotSignature?
    var lastUnmatched: LongScreenshotSignature?
    var atEnd = false
  }

  static let clampConfirmWait = 0.4

  mutating func resetClamp() {
    clamp = ClampState()
  }

  mutating func clearTransientClamp() {
    clamp.probe = nil
    clamp.lastUnmatched = nil
  }

  mutating func noteClampRequest(
    _ direction: LongScreenshotDirection, points: CGFloat, auto: Bool, at time: Double
  ) {
    switch direction {
    case .up:
      resetClamp()
    case .down:
      if var probe = clamp.probe, !probe.retested,
        time - probe.since >= LongScreenshotEdges.bounceSettle,
        auto || abs(points) >= LongScreenshotEdges.userDistance
      {
        probe.retested = true
        probe.since = time
        clamp.probe = probe
      }
    }
  }

  mutating func noteUnmatched(_ frame: LongScreenshotSignature, at time: Double) {
    if let sig = clamp.signature {
      if clamp.atEnd || reachedEnd, LongScreenshotMatcher.isStill(frame, sig, known: applied) {
        clamp.signature = frame
        clamp.lastUnmatched = frame
        edges.still(at: time)
        return
      }
      clamp.signature = nil
      clamp.atEnd = false
    } else if clamp.atEnd {
      clamp.atEnd = false
    }

    if var probe = clamp.probe {
      if LongScreenshotMatcher.isStill(frame, probe.signature, known: applied) {
        probe.signature = frame
        clamp.probe = probe
        clamp.lastUnmatched = frame
        drift = nil
        return
      }
      if probe.retested {
        clamp.probe = nil
        clamp.lastUnmatched = frame
        drift = nil
        lost = .down
        edges.unmatched()
        return
      }
      clamp.probe = (frame, time, false)
      clamp.lastUnmatched = frame
      drift = nil
      edges.unmatched()
      return
    }

    if !isAtEnd, position >= high.position - movingRows.count,
      frame.informative.contains(true),
      let req = edges.recentRequest(at: time), req.direction == .down,
      req.auto || req.pendingPoints <= CGFloat(resumeMargin) / max(geometry.scale, 1)
    {
      clamp.probe = (frame, time, false)
      clamp.lastUnmatched = frame
      drift = nil
      edges.unmatched()
      return
    }

    if let prev = clamp.lastUnmatched, !edges.isActive(at: time),
      LongScreenshotMatcher.isStill(frame, prev, known: applied)
    {
      clamp.lastUnmatched = frame
      return
    }

    clamp.lastUnmatched = frame
    if lost == nil, drift == nil, edges.isActive(at: time) {
      drift = (time, edges.heading(at: time))
    }
    edges.unmatched()
  }

  mutating func checkClamp(at time: Double) -> Update? {
    guard let probe = clamp.probe else { return nil }
    if probe.retested {
      guard time - probe.since >= Self.clampConfirmWait else {
        drift = nil
        return Update()
      }
      clamp.signature = probe.signature
      clamp.lastUnmatched = probe.signature
      clamp.probe = nil
      clamp.atEnd = true
      drift = nil
      lost = nil
      edges.clearAfterClamp()
      if !reachedEnd {
        let frameBottom = position + movingRows.upperBound
        if hi >= frameBottom, hi - frameBottom <= resumeMargin {
          return reach(.end)
        }
        reachedEnd = true
        endPosition = high.position
        offersTail = fits(geometry.tailRows.count)
      }
      var update = Update()
      update.reached = .end
      return update
    }
    if time - probe.since >= LongScreenshotEdges.memory {
      clamp.signature = probe.signature
      clamp.probe = nil
      drift = nil
      return nil
    }
    drift = nil
    return Update()
  }
}
