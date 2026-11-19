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
  struct VoteSample: Sendable {
    let row: Int32
    let segment: UInt16
    let key: UInt64
    let hash: Int
  }

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
  /// Pre-sampled informative cells across all horizontal segments (`segStep = 1`) for offset voting
  /// and open-addressed unique-row lookup table (`-1` empty, `-2` duplicate, `>= 0` unique row).
  let votesSample: [VoteSample]
  let indexKeys: [UInt64]
  let indexRows: [Int32]
  let indexMask: Int

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

    let total = cells.count
    var cap = 16
    let needed = max(16, total * 2)
    while cap < needed { cap <<= 1 }
    let mask = cap - 1
    var tableKeys = [UInt64](repeating: 0, count: cap)
    var tableRows = [Int32](repeating: -1, count: cap)
    var sample: [VoteSample] = []
    if total > 0 {
      cells.withUnsafeBufferPointer { cBuf in
        informative.withUnsafeBufferPointer { iBuf in
          tableKeys.withUnsafeMutableBufferPointer { tkBuf in
            tableRows.withUnsafeMutableBufferPointer { trBuf in
              let cPtr = cBuf.baseAddress!
              let iPtr = iBuf.baseAddress!
              let tkPtr = tkBuf.baseAddress!
              let trPtr = trBuf.baseAddress!
              var infoCount = 0
              if rows > 900 {
                var idx = 0
                while idx < total {
                  if iPtr[idx] { infoCount &+= 1 }
                  idx &+= 1
                }
              }
              let rowStep = rows > 900 ? (infoCount > total / 2 ? 4 : 2) : 1
              sample.reserveCapacity(min(total, (rows / rowStep + 128) * segments))
              var row = 0
              while row < rows {
                let rowBase = row &* segments
                let sampleRow =
                  rowStep == 1 || row < 64 || row >= rows - 64 || (row & (rowStep - 1) == 0)
                var seg = 0
                while seg < segments {
                  let idx = rowBase &+ seg
                  if iPtr[idx] {
                    let k = cPtr[idx] &+ UInt64(truncatingIfNeeded: seg) &* 0x9E37_79B9_7F4A_7C15
                    var h = (k ^ (k >> 30)) &* 0xBF58_476D_1CE4_E5B9
                    h = (h ^ (h >> 27)) &* 0x94D0_49BB_1331_11EB
                    let mixed = Int(truncatingIfNeeded: h ^ (h >> 31))
                    var slot = mixed & mask
                    while true {
                      let state = trPtr[slot]
                      if state == -1 {
                        tkPtr[slot] = k
                        trPtr[slot] = Int32(row)
                        break
                      }
                      if tkPtr[slot] == k {
                        trPtr[slot] = -2
                        break
                      }
                      slot = (slot &+ 1) & mask
                    }
                    if sampleRow {
                      sample.append(
                        VoteSample(row: Int32(row), segment: UInt16(seg), key: k, hash: mixed))
                    }
                  }
                  seg &+= 1
                }
                row &+= 1
              }
            }
          }
        }
      }
    }
    votesSample = sample
    indexKeys = tableKeys
    indexRows = tableRows
    indexMask = mask
  }

  /// Segments are about this wide; at most ``maximumSegments`` of them.
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
