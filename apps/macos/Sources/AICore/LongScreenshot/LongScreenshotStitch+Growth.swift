import Foundation

/// How the stitched rows grow, and what the page's edges and the image's limit do to them.
///
/// A frame adds the rows it shows past either end of what is stitched, exactly from there: one
/// that would leave a gap (it matched a frame stitched under a larger static part, or the page
/// jumped past an edge) adds nothing and waits. Growth stops at an edge the page reached, but
/// not for good: a page that pauses (lazy loading, a slow repaint) can grow later, so a frame
/// more than ``resumeMargin`` past the edge, further than an elastic overshoot goes, resumes
/// stitching there and drops what was kept past the edge. Growth stops for good at the image's
/// limit (``LongScreenshotGeometry/maxRows``), with the rows that still fit.
extension LongScreenshotStitch {
  static let maxWaypoints = 256
  static let maxFallbackChecks = 48
  static let maxAreaFallbackChecks = 12

  /// The image's height in rows, as ``layout`` draws it.
  public var imageRows: Int {
    let geometry = self.geometry
    let moving = movingRows
    let band = geometry.bandRows
    let top =
      addedHead
      ? geometry.headRows.count + moving.lowerBound
      : band.lowerBound - geometry.selectionRows.lowerBound + moving.lowerBound
    let footer = bandHeight - moving.upperBound
    let bottom =
      addedTail
      ? footer + geometry.tailRows.count
      : footer + geometry.selectionRows.upperBound - band.upperBound
    return top + hi - lo + bottom
  }

  /// How far past an edge the page must go before it counts as having grown: a third of the
  /// moving part, beyond an elastic overshoot.
  var resumeMargin: Int {
    max(LongScreenshotMatcher.minimumOverlap, movingRows.count / 3)
  }

  /// Whether the latest matched frame sits at the page's reached end, rather than scrolled up
  /// above an end reached earlier.
  public var isAtEnd: Bool {
    if clamp.atEnd { return true }
    guard reachedEnd else { return false }
    guard let endPosition else { return true }
    return position >= endPosition - resumeMargin
  }

  /// The rows a frame at `newPosition` adds before or after what is stitched; nil when it lies
  /// past them with a gap.
  mutating func grow(
    at newPosition: Int, hasArea: Bool = false, previousAreaPosition: Int? = nil
  ) -> Update? {
    let moving = movingRows
    let avail = hasArea ? areaMovingInBand : moving
    let top = newPosition + moving.lowerBound
    let bottom = newPosition + moving.upperBound
    let curDoc = (newPosition + avail.lowerBound)..<(newPosition + avail.upperBound)
    let prevDoc =
      (hasArea ? previousAreaPosition : nil).map {
        ($0 + avail.lowerBound)..<($0 + avail.upperBound)
      }
    let low = lo
    let high = hi
    let resumesEnd = reachedEnd && endPosition.map { newPosition - $0 > resumeMargin } == true
    let resumesStart =
      reachedStart && startPosition.map { $0 - newPosition > resumeMargin } == true
    let down = (!reachedEnd || resumesEnd) && !reachedLimit && bottom > high
    let up = (!reachedStart || resumesStart) && !reachedLimit && top < low
    let canGrowDown =
      !down || curDoc.lowerBound <= high
      || (prevDoc.map { $0.lowerBound <= high && $0.upperBound >= curDoc.lowerBound } ?? false)
    let canGrowUp =
      !up || curDoc.upperBound >= low
      || (prevDoc.map { $0.upperBound >= low && $0.lowerBound <= curDoc.upperBound } ?? false)
    guard canGrowDown, canGrowUp else { return nil }
    var update = Update()
    if resumesEnd {
      reachedEnd = false
      endPosition = nil
      resetClamp()
      update.dropsTail = offersTail
      offersTail = false
    }
    if resumesStart {
      reachedStart = false
      startPosition = nil
      update.dropsHead = offersHead
      offersHead = false
    }
    if down {
      let rows = room(for: bottom - high)
      if rows > 0 {
        let needEnd = high + rows
        if curDoc.lowerBound <= high {
          update.below = (high - newPosition)..<(needEnd - newPosition)
        } else if let prevPos = previousAreaPosition {
          let split = min(needEnd, curDoc.lowerBound)
          update.previousBelow = (high - prevPos)..<(split - prevPos)
          if split < needEnd {
            update.below = (split - newPosition)..<(needEnd - newPosition)
          }
        }
        stripsBelow = (stripsBelow?.lowerBound ?? high)..<needEnd
      }
    }
    if up, !reachedLimit {
      let rows = room(for: low - top)
      if rows > 0 {
        let needStart = low - rows
        if curDoc.upperBound >= low {
          update.above = (needStart - newPosition)..<(low - newPosition)
        } else if let prevPos = previousAreaPosition {
          let split = max(needStart, curDoc.upperBound)
          update.previousAbove = (split - prevPos)..<(low - prevPos)
          if needStart < split {
            update.above = (needStart - newPosition)..<(split - newPosition)
          }
        }
        stripsAbove = needStart..<(stripsAbove?.upperBound ?? low)
      }
    }
    return update
  }

  /// The page is at `edge`, if the image holds the latest frame's rows there: what was stitched
  /// past them is an overshoot and goes, and nothing more is stitched past it until the page
  /// grows. The scroll area's rows beyond the band, when they fit, are offered at each edge and
  /// join only while included.
  mutating func reach(_ edge: Edge) -> Update {
    var update = Update()
    let moving = movingRows
    switch edge {
    case .end:
      let frameBottom = position + moving.upperBound
      let bottom = max(moving.upperBound, frameBottom)
      // Stitching stopped short of the latest frame (the limit), or already holds content
      // beyond an elastic overshoot past it: its end is not the image's.
      guard !reachedEnd, hi >= frameBottom, hi - frameBottom <= resumeMargin else { return update }
      reachedEnd = true
      endPosition = position
      if let strips = stripsBelow, strips.upperBound > bottom {
        stripsBelow = strips.lowerBound < bottom ? strips.lowerBound..<bottom : nil
        update.keepBefore = bottom
        if high.position > position { high = current }
        if let prev = previous, prev.position > position { previous = nil }
        waypoints.removeAll { $0.position > position }
      }
      offersTail = fits(geometry.tailRows.count)
    case .start:
      let frameTop = position + moving.lowerBound
      let top = min(moving.lowerBound, frameTop)
      guard !reachedStart, lo <= frameTop, frameTop - lo <= resumeMargin else { return update }
      reachedStart = true
      startPosition = position
      if let strips = stripsAbove, strips.lowerBound < top {
        stripsAbove = strips.upperBound > top ? top..<strips.upperBound : nil
        update.keepFrom = top
        if low.position < position { low = current }
        if let prev = previous, prev.position < position { previous = nil }
        waypoints.removeAll { $0.position < position }
      }
      offersHead = fits(geometry.headRows.count)
    }
    update.reached = edge
    return update
  }

  /// Up to `wanted` rows the image still has room for; the limit is reached when it has fewer.
  private mutating func room(for wanted: Int) -> Int {
    let rows = min(wanted, max(0, geometry.maxRows - imageRows))
    if rows < wanted { reachedLimit = true }
    return rows
  }

  /// Whether `count` rows, some, would fit the image as it stands.
  func fits(_ count: Int) -> Bool {
    count > 0 && imageRows + count <= geometry.maxRows
  }

  /// Keeps interior reference frames spaced across the stitched range so fast manual scrolling
  /// can match anywhere inside `[lo, hi]` instead of stalling until ``low`` or ``high``.
  mutating func recordWaypoint(_ frame: Reference) {
    let stride = max(LongScreenshotMatcher.minimumOverlap * 2, movingRows.count / 2)
    guard waypoints.count < Self.maxWaypoints,
      !waypoints.contains(where: { abs($0.position - frame.position) < stride })
    else { return }
    waypoints.append(frame)
  }

  /// Matches `frame` (or `area`) against ``previous``, interior ``waypoints``, ``high``, or ``low``
  /// when ``current`` did not match and the resulting position agrees with scroll input and drift.
  func fallbackMatch(
    for frame: LongScreenshotSignature, area: LongScreenshotSignature? = nil, at time: Double
  ) -> (outcome: LongScreenshotMatcher.Outcome, reference: Reference, matchedArea: Bool)? {
    func targetPosition(for outcome: LongScreenshotMatcher.Outcome, from base: Int) -> Int? {
      switch outcome {
      case .moved(let offset, _): base + offset
      case .still: base
      case .unmatched: nil
      }
    }
    var areaChecks = 0
    for candidate in fallbackCandidates(at: time) {
      let isPriority =
        candidate.position == previous?.position || candidate.position == high.position
        || candidate.position == low.position
      if let area, let candidateArea = candidate.area,
        isPriority || areaChecks < Self.maxAreaFallbackChecks
      {
        if !isPriority { areaChecks += 1 }
        let areaRetry = LongScreenshotMatcher.match(area, to: candidateArea, known: areaApplied)
        if let target = targetPosition(for: areaRetry, from: candidate.position),
          allowsFallback(to: candidate, target: target, at: time)
        {
          return (areaRetry, candidate, true)
        }
        continue
      }
      let retry = LongScreenshotMatcher.match(frame, to: candidate.signature, known: applied)
      if let target = targetPosition(for: retry, from: candidate.position),
        allowsFallback(to: candidate, target: target, at: time)
      {
        return (retry, candidate, false)
      }
    }
    return nil
  }

  private func fallbackCandidates(at time: Double) -> [Reference] {
    var result: [Reference] = []
    var seen: Set<Int> = [current.position]
    if let previous, seen.insert(previous.position).inserted {
      result.append(previous)
    }
    let request = edges.recentRequest(at: time)
    var pool: [Reference] = []
    for ref in waypoints + [high, low] where seen.insert(ref.position).inserted {
      pool.append(ref)
    }
    if request?.auto == true, lost == nil, drift == nil {
      let window = matchWindowRows
      let nearby = pool.filter { abs($0.position - position) <= window }
        .sorted { abs($0.position - position) < abs($1.position - position) }
      result.append(contentsOf: nearby.prefix(Self.maxFallbackChecks))
      return result
    }
    let margin = resumeMargin
    let ordered: [Reference]
    switch request?.direction {
    case .down where request?.auto == false:
      let forward = pool.filter { $0.position >= position - margin }
        .sorted { abs($0.position - position) < abs($1.position - position) }
      let backward = pool.filter { $0.position < position - margin }
        .sorted { abs($0.position - position) < abs($1.position - position) }
      ordered = forward + backward
    case .up where request?.auto == false:
      let anchor = (lost ?? drift?.heading) == .down ? max(position, high.position) : position
      let upward = pool.filter { $0.position <= anchor + margin }
        .sorted { abs($0.position - anchor) < abs($1.position - anchor) }
      let downward = pool.filter { $0.position > anchor + margin }
        .sorted { abs($0.position - position) < abs($1.position - position) }
      ordered = upward + downward
    default:
      ordered = pool.sorted { abs($0.position - position) < abs($1.position - position) }
    }
    result.append(contentsOf: ordered.prefix(Self.maxFallbackChecks))
    for boundary in [high, low]
    where !result.contains(where: { $0.position == boundary.position })
      && boundary.position != current.position
    {
      result.append(boundary)
    }
    return result
  }

  private func allowsFallback(to end: Reference, target: Int, at time: Double) -> Bool {
    guard let request = edges.recentRequest(at: time) else { return true }
    let delta = target - position
    let margin = resumeMargin
    let window = matchWindowRows
    if request.auto {
      switch request.direction {
      case .down:
        if delta < ((lost == nil && drift == nil) ? 0 : -margin) { return false }
      case .up:
        if delta > window { return false }
        if lost == nil, drift == nil, delta > margin { return false }
      }
      guard end.position != previous?.position else { return true }
      if lost == nil, drift == nil {
        return request.direction == .down
          ? (delta >= 0 && delta <= window)
          : abs(delta) <= margin
      }
      if (lost ?? drift?.heading) != .up, end.position == low.position,
        end.position != high.position
      {
        return false
      }
      return abs(delta) <= window * 2
    }
    let activePoints = max(request.pendingPoints, request.burstPoints)
    if activePoints >= LongScreenshotEdges.userDistance, lost == nil, drift == nil {
      switch request.direction {
      case .down where delta < 0: return false
      case .up where delta > 0: return false
      default: break
      }
    }
    if reversedWhileUnmatched, (low.position - margin)...(high.position + margin) ~= target {
      return true
    }
    let beyondEnd = (lost ?? drift?.heading) == .down && position >= high.position - margin
    if beyondEnd, high.position - target > window {
      return activePoints * 4 * geometry.scale >= CGFloat(high.position - target)
    }
    let beyondStart = (lost ?? drift?.heading) == .up && position <= low.position + margin
    if beyondStart, target - low.position > window {
      return activePoints * 4 * geometry.scale >= CGFloat(target - low.position)
    }
    return true
  }
}

extension LongScreenshotStitch.Update {
  func merged(with other: Self) -> Self {
    var merged = self
    merged.above = merged.above ?? other.above
    merged.below = merged.below ?? other.below
    merged.previousAbove = merged.previousAbove ?? other.previousAbove
    merged.previousBelow = merged.previousBelow ?? other.previousBelow
    merged.keepFrom = other.keepFrom ?? merged.keepFrom
    merged.keepBefore = other.keepBefore ?? merged.keepBefore
    merged.reached = other.reached ?? merged.reached
    merged.dropsHead = merged.dropsHead || other.dropsHead
    merged.dropsTail = merged.dropsTail || other.dropsTail
    return merged
  }
}
