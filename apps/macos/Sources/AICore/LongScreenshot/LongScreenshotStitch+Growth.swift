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

  /// The rows a frame at `newPosition` adds before or after what is stitched; nil when it lies
  /// past them with a gap.
  mutating func grow(at newPosition: Int) -> Update? {
    let moving = movingRows
    let top = newPosition + moving.lowerBound
    let bottom = newPosition + moving.upperBound
    let low = lo
    let high = hi
    let resumesEnd = reachedEnd && endPosition.map { newPosition - $0 > resumeMargin } == true
    let resumesStart =
      reachedStart && startPosition.map { $0 - newPosition > resumeMargin } == true
    let down = (!reachedEnd || resumesEnd) && !reachedLimit && bottom > high
    let up = (!reachedStart || resumesStart) && !reachedLimit && top < low
    guard !(down && top > high), !(up && bottom < low) else { return nil }
    var update = Update()
    if resumesEnd {
      reachedEnd = false
      endPosition = nil
      update.dropsTail = offersTail
      offersTail = false
    }
    if resumesStart {
      reachedStart = false
      startPosition = nil
      update.dropsHead = addedHead
      addedHead = false
    }
    if down {
      let rows = room(for: bottom - high)
      if rows > 0 {
        update.below = (high - newPosition)..<(high - newPosition + rows)
        stripsBelow = (stripsBelow?.lowerBound ?? high)..<(high + rows)
      }
    }
    if up, !reachedLimit {
      let rows = room(for: low - top)
      if rows > 0 {
        update.above = (low - newPosition - rows)..<(low - newPosition)
        stripsAbove = (low - rows)..<(stripsAbove?.upperBound ?? low)
      }
    }
    return update
  }

  /// The page is at `edge`, if the image holds the latest frame's rows there: what was stitched
  /// past them is an overshoot and goes, and nothing more is stitched past it until the page
  /// grows. The scroll area's rows beyond the band, when they fit, join at the start; at the end
  /// they are offered, and join only while ``includesTail``.
  mutating func reach(_ edge: Edge) -> Update {
    var update = Update()
    let moving = movingRows
    switch edge {
    case .end:
      let bottom = max(moving.upperBound, position + moving.upperBound)
      // Stitching stopped short of the latest frame (the limit): its end is not the image's.
      guard !reachedEnd, hi >= bottom else { return update }
      reachedEnd = true
      endPosition = position
      if let strips = stripsBelow, strips.upperBound > bottom {
        stripsBelow = strips.lowerBound < bottom ? strips.lowerBound..<bottom : nil
        update.keepBefore = bottom
      }
      offersTail = fits(geometry.tailRows.count)
    case .start:
      let top = min(moving.lowerBound, position + moving.lowerBound)
      guard !reachedStart, lo <= top else { return update }
      reachedStart = true
      startPosition = position
      if let strips = stripsAbove, strips.lowerBound < top {
        stripsAbove = strips.upperBound > top ? top..<strips.upperBound : nil
        update.keepFrom = top
      }
      addedHead = adds(geometry.headRows.count)
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

  /// Whether `count` rows past the band join the image: there are some, and they fit.
  private mutating func adds(_ count: Int) -> Bool {
    guard count > 0 else { return false }
    guard fits(count) else {
      reachedLimit = true
      return false
    }
    return true
  }

  /// Whether `count` rows, some, would fit the image as it stands.
  private func fits(_ count: Int) -> Bool {
    count > 0 && imageRows + count <= geometry.maxRows
  }
}
