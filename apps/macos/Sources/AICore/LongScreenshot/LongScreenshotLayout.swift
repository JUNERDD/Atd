import Foundation

/// How a long screenshot's image is put together from its pixels, top to bottom:
///
/// 1. The top: the first frame from the selection's top to the end of the sticky header; once
///    the page reached its start, the scroll area's rows above the band (the head, from the
///    frame at the start) and then the header.
/// 2. The stitched document rows: strips and the first frame's moving rows in the live columns;
///    the other columns (outside the scroll area, its scroll bar lane, fixed side columns) are
///    the first frame's, its first and last moving rows continued where the stitched rows reach
///    past it.
/// 3. The bottom: the pinned footer and the selection below the band from the first frame;
///    once the page reached its end and the user added the part below the selection
///    (``LongScreenshotStitch/addedTail``), the footer and then the scroll area's rows below the
///    band (the tail, from the frame at the end).
///
/// Head and tail rows outside the band's columns continue the first frame's nearest row, so the
/// image never shows what lies outside both the selection and the scroll area.
public struct LongScreenshotLayout: Equatable, Sendable {
  public enum Source: Equatable, Sendable {
    /// The first frame; rows are stream rows.
    case first
    /// The strips and nothing else; rows are document rows.
    case strips
    /// The rows past the band kept at the page's start and end; rows count from their top.
    case head, tail
  }

  /// One drawing: `rows` of `source`, at image row `top`, over `columns`; a single source row
  /// repeated over `height` rows when `stretched`.
  public struct Piece: Equatable, Sendable {
    public let source: Source
    public let rows: Range<Int>
    public let top: Int
    public let height: Int
    public let columns: Range<Int>

    public var stretched: Bool { height != rows.count }
  }

  public let width: Int
  public let height: Int
  public let pieces: [Piece]
  /// The image rows the selection shows now.
  public let view: Range<Int>
}

extension LongScreenshotStitch {
  /// The image as it stands.
  public var layout: LongScreenshotLayout {
    let geometry = self.geometry
    let moving = movingRows
    let band = geometry.bandRows
    let selection = geometry.selectionRows
    let all = 0..<geometry.width
    let live = liveColumns
    var pieces: [LongScreenshotLayout.Piece] = []
    func add(
      _ source: LongScreenshotLayout.Source, _ rows: Range<Int>, at top: Int,
      height: Int? = nil, columns: Range<Int>
    ) {
      guard !rows.isEmpty, !columns.isEmpty, (height ?? rows.count) > 0 else { return }
      pieces.append(
        .init(
          source: source, rows: rows, top: top, height: height ?? rows.count, columns: columns))
    }
    func outside(_ columns: Range<Int>) -> [Range<Int>] {
      [0..<columns.lowerBound, columns.upperBound..<geometry.width]
    }

    // 1. The top, to the end of the header.
    let headerEnd = band.lowerBound + moving.lowerBound
    var top = 0
    if addedHead {
      let head = geometry.headRows.count
      add(.head, 0..<head, at: 0, columns: geometry.bandColumns)
      for columns in outside(geometry.bandColumns) {
        add(.first, band.lowerBound..<(band.lowerBound + 1), at: 0, height: head, columns: columns)
      }
      top = head
      add(.first, band.lowerBound..<headerEnd, at: top, columns: all)
      top += headerEnd - band.lowerBound
    } else {
      add(.first, selection.lowerBound..<headerEnd, at: 0, columns: all)
      top = headerEnd - selection.lowerBound
    }

    // 2. The stitched rows.
    let lo = self.lo
    let hi = self.hi
    let firstRows = headerEnd..<(band.lowerBound + moving.upperBound)
    let firstTop = top + moving.lowerBound - lo
    add(.strips, lo..<hi, at: top, columns: live)
    add(.first, firstRows, at: firstTop, columns: live)
    for columns in outside(live) {
      add(.first, firstRows, at: firstTop, columns: columns)
      add(.first, firstRows.prefix(1), at: top, height: firstTop - top, columns: columns)
      let below = firstTop + firstRows.count
      add(.first, firstRows.suffix(1), at: below, height: top + hi - lo - below, columns: columns)
    }
    let contentEnd = top + hi - lo

    // 3. The bottom, from the footer.
    let footerStart = band.lowerBound + moving.upperBound
    var bottom = contentEnd
    if addedTail {
      add(.first, footerStart..<band.upperBound, at: bottom, columns: all)
      bottom += band.upperBound - footerStart
      let tail = geometry.tailRows.count
      add(.tail, 0..<tail, at: bottom, columns: geometry.bandColumns)
      for columns in outside(geometry.bandColumns) {
        add(
          .first, (band.upperBound - 1)..<band.upperBound, at: bottom, height: tail,
          columns: columns)
      }
      bottom += tail
    } else {
      add(.first, footerStart..<selection.upperBound, at: bottom, columns: all)
      bottom += max(0, selection.upperBound - footerStart)
    }

    // Where the selection's top would sit if the latest frame were laid on the image: its first
    // moving row is document row `position + moving.lowerBound`.
    let viewTop =
      top + position + moving.lowerBound - lo - (headerEnd - selection.lowerBound)
    let viewRows = selection.count
    let clampedTop = min(max(0, viewTop), max(0, bottom - viewRows))
    return LongScreenshotLayout(
      width: geometry.width, height: bottom, pieces: pieces,
      view: clampedTop..<min(bottom, clampedTop + viewRows))
  }

  /// The columns whose pixels move with the page: the geometry's live columns without the
  /// fixed side columns (counted from the compared columns' edges).
  public var liveColumns: Range<Int> {
    let live = geometry.liveColumns
    let matched = geometry.matchedColumns
    let parts = applied
    let lower =
      parts.left > 0 ? max(live.lowerBound, matched.lowerBound + parts.left) : live.lowerBound
    let upper =
      parts.right > 0 ? min(live.upperBound, matched.upperBound - parts.right) : live.upperBound
    return lower..<max(lower, upper)
  }
}
