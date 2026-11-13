import Foundation

/// What one frame's band looks like to the matcher: every band row cut into a few column
/// segments, each segment hashed, plus one hash per compared column over all band rows. The shell
/// hashes a frame's pixels into one (`LongScreenshotSignature.hashing` in AIShell); equal pixels
/// give equal hashes, and the matcher's overlap check makes an accidental collision harmless.
///
/// Segments, rather than one hash per row, let the matcher tell a page that scrolls beside a
/// fixed side column (whose segments keep their place) from one that changed: a whole-row hash
/// would mix both and match nothing. A cell whose pixels are all one colour carries no
/// information (blank rows match everywhere), so it never votes, though it still has to agree.
public struct LongScreenshotSignature: Sendable {
  /// Band rows.
  public let rows: Int
  /// Column segments per row.
  public let segments: Int
  /// `rows × segments` cell hashes, row by row.
  public let cells: [UInt64]
  /// Whether each cell holds more than one colour.
  public let informative: [Bool]
  /// One hash per compared column over every band row, left to right.
  public let columns: [UInt64]
  /// Whether each column holds more than one colour.
  public let columnsInformative: [Bool]

  public init(
    rows: Int, segments: Int, cells: [UInt64], informative: [Bool], columns: [UInt64],
    columnsInformative: [Bool]
  ) {
    precondition(cells.count == rows * segments && informative.count == cells.count)
    precondition(columns.count == columnsInformative.count)
    self.rows = rows
    self.segments = segments
    self.cells = cells
    self.informative = informative
    self.columns = columns
    self.columnsInformative = columnsInformative
  }

  /// Segments are about this wide; at most ``maximumSegments`` of them. Narrow enough that the
  /// segment straddling a fixed column's edge is a small share of a row.
  public static let segmentWidth = 48
  public static let maximumSegments = 16

  /// The segment count for `columns` compared columns.
  public static func segmentCount(columns: Int) -> Int {
    min(maximumSegments, max(1, columns / segmentWidth))
  }

  /// The columns, counted from the first compared one, that segment `index` of `segments`
  /// covers across `columns` compared columns.
  public static func segmentColumns(_ index: Int, of segments: Int, columns: Int) -> Range<Int> {
    (columns * index / segments)..<(columns * (index + 1) / segments)
  }

  public func cell(_ row: Int, _ segment: Int) -> UInt64 { cells[row * segments + segment] }
  public func isInformative(_ row: Int, _ segment: Int) -> Bool {
    informative[row * segments + segment]
  }
}
