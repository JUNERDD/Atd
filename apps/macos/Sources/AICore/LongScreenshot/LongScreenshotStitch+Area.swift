import Foundation

/// Extended scroll-area matching, direct-offset direction gating, boundary stillness
/// re-anchoring, and statics projection for ``LongScreenshotStitch``.
///
/// ScreenCaptureKit streams the vertical union of the selection and the scroll area, so frames hold
/// ``LongScreenshotGeometry/areaRows`` even when ``LongScreenshotGeometry/bandRows`` is a narrow
/// slice inside it. Matching prefers the full scroll-area signature whenever present so repeating
/// card grids inside a narrow band never alias against wider non-repeating context, while keeping
/// the stitched document bounds strictly equal to what passed through the selection box.
extension LongScreenshotStitch {
  struct FrameMatch {
    let outcome: LongScreenshotMatcher.Outcome
    let reference: Reference
    let usedFallback: Bool
    let matchedArea: Bool
    var reanchoredStill = false
  }

  /// The static parts in use across ``LongScreenshotGeometry/areaRows``.
  var areaApplied: LongScreenshotMatcher.Static {
    var parts = areaStatics ?? .none
    parts.left = leftSide.pairs >= 2 ? leftSide.columns : 0
    parts.right = rightSide.pairs >= 2 ? rightSide.columns : 0
    return parts
  }

  /// Moving rows of ``LongScreenshotGeometry/areaRows`` expressed in band-relative coordinates
  /// (`0` at `bandRows.lowerBound`), always spanning at least ``movingRows``.
  var areaMovingInBand: Range<Int> {
    let head = geometry.headRows.count
    let moving = movingRows
    let areaMoving = LongScreenshotMatcher.movingRegion(
      rows: geometry.areaRows.count, known: areaApplied)
    var lower = areaMoving.lowerBound - head
    var upper = areaMoving.upperBound - head
    if (statics?.top ?? 0) > 0 { lower = max(lower, moving.lowerBound) }
    if (statics?.bottom ?? 0) > 0 { upper = min(upper, moving.upperBound) }
    lower = min(lower, moving.lowerBound)
    upper = max(upper, moving.upperBound)
    return lower..<upper
  }

  /// Maximum single-step displacement a reference can bridge during fallback matching.
  var matchWindowRows: Int {
    current.area != nil ? max(movingRows.count, areaMovingInBand.count) : movingRows.count
  }

  /// Rejects large opposite-direction jumps on direct `current` matches during an active scroll
  /// burst while still permitting genuine elastic rubber-band spring-back (`<= maxBounce`).
  func allowsDirectOffset(_ offset: Int, at time: Double) -> Bool {
    guard lost == nil, drift == nil, let req = edges.recentRequest(at: time), req.age < 0.35
    else { return true }
    let maxBounce = max(
      LongScreenshotMatcher.minimumOverlap, Int((36 * geometry.scale).rounded(.up)))
    if !req.auto, max(req.pendingPoints, req.burstPoints) >= LongScreenshotEdges.userDistance {
      switch req.direction {
      case .up where offset > maxBounce: return false
      case .down where offset < -maxBounce: return false
      default: break
      }
    }
    if req.auto, req.direction == .down, offset < -maxBounce {
      return false
    }
    return true
  }

  /// Matches `area` first against `current.area` when available (falling back to small in-band
  /// matches only if `area` returned `.unmatched`), re-anchors `.still` frames at `low` or `high`
  /// when returning to a stitched boundary, and otherwise tries `fallbackMatch`.
  func matchFrame(
    _ frame: LongScreenshotSignature, area: LongScreenshotSignature?, at time: Double
  ) -> FrameMatch {
    if let area, let currentArea = current.area {
      let directArea = LongScreenshotMatcher.match(area, to: currentArea, known: areaApplied)
      switch directArea {
      case .moved(let offset, _) where allowsDirectOffset(offset, at: time):
        return FrameMatch(
          outcome: directArea, reference: current, usedFallback: false, matchedArea: true)
      case .still:
        if let reanchored = reanchorBoundaryIfStill(frame: frame, area: area, at: time) {
          return reanchored
        }
        return FrameMatch(
          outcome: .still, reference: current, usedFallback: false, matchedArea: true)
      case .unmatched:
        let directBand = LongScreenshotMatcher.match(frame, to: current.signature, known: applied)
        switch directBand {
        case .still:
          if let reanchored = reanchorBoundaryIfStill(frame: frame, area: area, at: time) {
            return reanchored
          }
          return FrameMatch(
            outcome: .still, reference: current, usedFallback: false, matchedArea: false)
        case .moved(let offset, _)
        where abs(offset) <= movingRows.count / 2 && allowsDirectOffset(offset, at: time):
          return FrameMatch(
            outcome: directBand, reference: current, usedFallback: false, matchedArea: false)
        default:
          break
        }
      default:
        break
      }
    } else {
      let direct = LongScreenshotMatcher.match(frame, to: current.signature, known: applied)
      switch direct {
      case .moved(let offset, _) where allowsDirectOffset(offset, at: time):
        return FrameMatch(
          outcome: direct, reference: current, usedFallback: false, matchedArea: false)
      case .still:
        if let reanchored = reanchorBoundaryIfStill(frame: frame, area: area, at: time) {
          return reanchored
        }
        return FrameMatch(
          outcome: .still, reference: current, usedFallback: false, matchedArea: false)
      default:
        break
      }
    }
    if let fallback = fallbackMatch(for: frame, area: area, at: time) {
      return FrameMatch(
        outcome: fallback.outcome, reference: fallback.reference, usedFallback: true,
        matchedArea: fallback.matchedArea)
    }
    return FrameMatch(
      outcome: .unmatched, reference: current, usedFallback: false, matchedArea: false)
  }

  /// Snaps residual drift back to `low` or `high` when `current` is `.still` and the screen has
  /// returned to a stitched boundary with sufficient moving-segment informative evidence.
  private func reanchorBoundaryIfStill(
    frame: LongScreenshotSignature, area: LongScreenshotSignature?, at time: Double
  ) -> FrameMatch? {
    guard let dir = edges.recentRequest(at: time)?.direction else { return nil }
    let boundary: Reference? =
      switch dir {
      case .up where current.position > low.position: low
      case .down where current.position < high.position: high
      default: nil
      }
    guard let boundary else { return nil }
    if let area, let boundaryArea = boundary.area {
      guard
        LongScreenshotMatcher.isStill(
          area, boundaryArea, known: areaApplied, minimumInformativeCells: 16)
      else { return nil }
      return FrameMatch(
        outcome: .still, reference: boundary, usedFallback: true, matchedArea: true,
        reanchoredStill: true)
    }
    guard
      LongScreenshotMatcher.isStill(
        frame, boundary.signature, known: applied, minimumInformativeCells: 16)
    else { return nil }
    return FrameMatch(
      outcome: .still, reference: boundary, usedFallback: true, matchedArea: false,
      reanchoredStill: true)
  }

  /// Adopts a moving pair's static parts measured on ``LongScreenshotGeometry/areaRows`` and
  /// projects any static header, footer, or side columns overlapping ``LongScreenshotGeometry/bandRows``.
  mutating func adoptArea(_ pair: LongScreenshotMatcher.Static) {
    if var known = areaStatics {
      known.top = min(known.top, pair.top)
      known.bottom = min(known.bottom, pair.bottom)
      areaStatics = known
    } else {
      areaStatics = LongScreenshotMatcher.Static(
        top: pair.top, bottom: pair.bottom, left: 0, right: 0)
    }
    let head = geometry.headRows.count
    let tail = geometry.tailRows.count
    let top = min(bandHeight, max(0, pair.top - head))
    let bottom = min(bandHeight - top, max(0, pair.bottom - tail))
    if top + bottom <= bandHeight - 2 * LongScreenshotMatcher.minimumOverlap {
      adopt(
        LongScreenshotMatcher.Static(
          top: top, bottom: bottom, left: pair.left, right: pair.right))
    } else {
      Self.count(pair.left, into: &leftSide)
      Self.count(pair.right, into: &rightSide)
    }
  }

  /// Takes in a moving pair's static parts: each only ever shrinks, since a row or column that
  /// moved once is not static.
  mutating func adopt(_ pair: LongScreenshotMatcher.Static) {
    if var known = statics {
      known.top = min(known.top, pair.top)
      known.bottom = min(known.bottom, pair.bottom)
      statics = known
    } else {
      statics = LongScreenshotMatcher.Static(
        top: pair.top, bottom: pair.bottom, left: 0, right: 0)
    }
    Self.count(pair.left, into: &leftSide)
    Self.count(pair.right, into: &rightSide)
  }

  static func count(_ columns: Int, into side: inout (pairs: Int, columns: Int)) {
    guard columns > 0 else { return }
    side = side.pairs == 0 ? (1, columns) : (side.pairs + 1, min(side.columns, columns))
  }

  mutating func remember(_ frame: Reference) {
    position = frame.position
    previous = current
    current = frame
    if frame.position <= low.position { low = frame }
    if frame.position >= high.position { high = frame }
    recordWaypoint(frame)
  }
}
