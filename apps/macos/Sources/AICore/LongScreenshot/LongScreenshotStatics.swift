import Foundation

/// The parts of a band that stayed in place while the page moved, as one moving pair of frames
/// shows them (decision D3): a sticky header at the top, a pinned footer at the bottom, fixed
/// side columns at the edges. They are kept once in the stitched image, from the first frame.
///
/// Each cell of the new frame is compared in place and at the offset. Stayed (equal in place,
/// not at the offset) and moved (the reverse) are evidence; equal both ways is no evidence (a
/// blank stretch); equal neither way is a mismatch. Rows the offset takes past the reference
/// (new content) can only be compared in place: a uniform cell equal there is weak evidence of
/// staying (a footer's border line, or a blank stretch of new content). A static row has evidence
/// of staying and none of moving; the header is the leading run of static, weakly static and
/// blank rows that ends at the last of the first two kinds, and counts only with at least one
/// static row, so a blank page bottom is never a footer. Columns stay when their whole-band hash is unchanged, but only next to
/// a segment whose informative cells stayed in the moving rows: a blank margin whose only
/// content is a header's background would otherwise count as a side column, and full-width
/// content further down the page would lose its edges.
enum LongScreenshotStatics {
  /// A static row or segment holds at most one mismatching cell (a progress bar in a header, a
  /// caret) for every this many cells that stayed.
  static let mismatchShare = 4

  static func detect(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, offset: Int,
    known: LongScreenshotMatcher.Static
  ) -> LongScreenshotMatcher.Static {
    let kinds = (0..<frame.rows).map { rowKind(frame, reference, row: $0, offset: offset) }
    let top = run(kinds)
    let bottom = run(kinds.reversed())
    // Statics that leave no room for two overlaps are not believable from one pair.
    guard top + bottom <= frame.rows - 2 * LongScreenshotMatcher.minimumOverlap else {
      return known
    }
    let moving = top..<(frame.rows - bottom)
    let staying = (0..<frame.segments).map {
      segmentStayed(frame, reference, segment: $0, rows: moving, offset: offset)
    }
    let columns = frame.columns.count
    var left = columnRun(frame, reference, order: Array(0..<columns))
    var right = columnRun(frame, reference, order: Array((0..<columns).reversed()))
    left = bounded(left, staying: staying, columns: columns, fromRight: false)
    right = bounded(right, staying: staying.reversed(), columns: columns, fromRight: true)
    if left + right > columns * 3 / 4 {
      left = 0
      right = 0
    }
    return LongScreenshotMatcher.Static(top: top, bottom: bottom, left: left, right: right)
  }

  private enum Kind { case stayed, weak, moved, blank }

  private static func rowKind(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, row: Int, offset: Int
  ) -> Kind {
    let shifted = row + offset
    let inRange = shifted >= 0 && shifted < frame.rows
    var stayed = 0
    var weak = 0
    var moved = 0
    var mismatched = 0
    for segment in 0..<frame.segments {
      let cell = frame.cell(row, segment)
      let same = cell == reference.cell(row, segment)
      guard inRange else {
        // New content, comparable in place only.
        if !same {
          moved += 1
        } else if frame.isInformative(row, segment) {
          stayed += 1
        } else {
          weak += 1
        }
        continue
      }
      let along = cell == reference.cell(shifted, segment)
      switch (same, along) {
      case (true, false): stayed += 1
      case (false, true): moved += 1
      case (false, false): mismatched += 1
      case (true, true): break
      }
    }
    if stayed > 0, moved == 0, mismatched * mismatchShare <= stayed { return .stayed }
    if stayed == 0, moved == 0, mismatched == 0 { return weak > 0 ? .weak : .blank }
    return .moved
  }

  /// The rows up to and including the last static or weakly static row of the leading run of
  /// such rows and blank ones; none unless the run holds a static row.
  private static func run<Rows: Sequence<Kind>>(_ kinds: Rows) -> Int {
    var end = 0
    var evidenced = false
    for (index, kind) in kinds.enumerated() {
      switch kind {
      case .stayed:
        end = index + 1
        evidenced = true
      case .weak: end = index + 1
      case .blank: continue
      case .moved: return evidenced ? end : 0
      }
    }
    return evidenced ? end : 0
  }

  /// Whether segment `segment`'s informative cells in the moving rows stayed in place.
  private static func segmentStayed(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, segment: Int,
    rows: Range<Int>, offset: Int
  ) -> Bool {
    var stayed = 0
    var other = 0
    for row in rows where frame.isInformative(row, segment) {
      let cell = frame.cell(row, segment)
      let same = cell == reference.cell(row, segment)
      let shifted = row + offset
      let along = shifted >= 0 && shifted < frame.rows && cell == reference.cell(shifted, segment)
      if same, !along { stayed += 1 } else if !same { other += 1 }
    }
    return stayed >= 2 && other * mismatchShare <= stayed
  }

  /// The leading run, in `order`, of columns that kept their whole-band hash, ending at the last
  /// informative one (blank columns may sit inside the run).
  private static func columnRun(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, order: [Int]
  ) -> Int {
    var end = 0
    for (index, column) in order.enumerated() {
      guard frame.columns[column] == reference.columns[column] else { return end }
      if frame.columnsInformative[column] { end = index + 1 }
    }
    return end
  }

  /// `run` columns from one edge, kept only when a segment lying wholly inside it stayed, and
  /// cut at the end of the segment after the last such one. `staying` is ordered from that edge.
  private static func bounded(_ run: Int, staying: [Bool], columns: Int, fromRight: Bool) -> Int {
    let segments = staying.count
    // The columns the first `count` segments from the edge cover.
    func covered(_ count: Int) -> Int {
      fromRight ? columns - columns * (segments - count) / segments : columns * count / segments
    }
    var limit = 0
    for index in 0..<segments {
      guard covered(index + 1) <= run, staying[index] else { break }
      limit = covered(min(index + 2, segments))
    }
    return min(run, limit)
  }
}
