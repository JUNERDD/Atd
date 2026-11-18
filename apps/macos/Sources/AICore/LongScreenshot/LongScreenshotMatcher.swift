import Foundation

/// How far the page under a long screenshot's band moved between two frames (decision D3), and
/// which parts of the band stayed in place while it moved.
///
/// The band's cells (``LongScreenshotSignature``) vote: each informative cell of the new frame
/// that changed in place and whose hash occurs uniquely in the reference's segment votes for the
/// offset between the two rows. The strongest offsets are then verified over the whole overlap of
/// the moving part (`LongScreenshotMatcher+Verification.swift`): a cell either agrees at the
/// offset, stayed in place (a static part), or is a mismatch, and the agreeing share must reach
/// ``minimumScore``. Exactly one offset must verify; two that do mean repeating content, and
/// nothing is stitched, as for no overlap at all ("never stitch a guess"). An offset of zero is
/// not a movement: a frame that agrees in place is ``Outcome/still``, which is how the page's ends
/// are seen.
///
/// Prior art checked (no Swift package offers this): ScrollSnap (MIT) registers five horizontal
/// bands with Vision and lets them vote, at about 4 fps while the user scrolls — its band vote is
/// the idea kept here, without Vision. macshot (GPL-3.0) was read for ideas only and none of its
/// code is used. ScreenCap (MIT) compares row signatures, the basis of these cells. Vision's
/// `VNTranslationalImageRegistrationRequest` was rejected: it answers one global shift for the
/// whole image, so a sticky header or a fixed side column pulls it towards zero, its confidence is
/// undocumented, and it has no answer for "these frames do not overlap", which stitching needs.
public enum LongScreenshotMatcher {
  /// The parts of the band that kept their place while the page scrolled.
  public struct Static: Equatable, Sendable {
    /// Band rows at the top (a sticky header) and at the bottom (a pinned footer).
    public var top: Int
    public var bottom: Int
    /// Compared columns at the left and right edges (fixed side columns).
    public var left: Int
    public var right: Int

    public init(top: Int, bottom: Int, left: Int, right: Int) {
      self.top = top
      self.bottom = bottom
      self.left = left
      self.right = right
    }

    public static let none = Static(top: 0, bottom: 0, left: 0, right: 0)
  }

  public enum Outcome: Equatable, Sendable {
    /// The page went down by `offset` rows from the reference to the frame (up when negative);
    /// `statics` is what this pair shows of the parts that stayed in place.
    case moved(offset: Int, statics: Static)
    /// The frame shows what the reference shows, in place.
    case still
    /// No single offset explains the frame: it does not overlap the reference, the content
    /// repeats, or it changed.
    case unmatched
  }

  /// The shortest overlap of the moving part worth trusting, in rows.
  public static let minimumOverlap = 24
  /// The share of the overlap's cells that must agree at the offset.
  public static let minimumScore = 0.85
  /// Minimum agreeing share among non-invariant informative cells across kept moving segments.
  public static let minimumInformativeScore = 0.72
  /// Rows with an informative agreeing cell an offset needs: at least this many, and at least
  /// ``minimumEvidenceShare`` of the overlap's informative rows.
  public static let minimumEvidenceRows = 8
  public static let minimumEvidenceShare = 0.2
  /// The share of informative cells that must agree in place for a frame to be still.
  public static let minimumStillShare = 0.9
  /// Offsets voted for this many times or fewer are not worth verifying.
  static let minimumVotes = 4
  /// Offsets this close to a stronger one are the same peak.
  static let peakWidth = 2
  /// The strongest offsets verified.
  static let candidates = 4

  /// Compares `frame` with `reference`, both of the same band. `known` is what earlier pairs
  /// showed of the static parts; its rows and side columns are left out of the moving part.
  public static func match(
    _ frame: LongScreenshotSignature, to reference: LongScreenshotSignature, known: Static
  ) -> Outcome {
    guard frame.rows == reference.rows, frame.segments == reference.segments,
      frame.columns.count == reference.columns.count
    else { return .unmatched }
    let region = movingRegion(rows: frame.rows, known: known)
    let movingSegs = movingSegments(
      segments: frame.segments, columns: frame.columns.count, known: known)
    let verified = strongestOffsets(
      frame, reference, region: region, movingSegs: movingSegs
    ).filter {
      verifies(frame, reference, offset: $0, region: region, movingSegs: movingSegs)
    }
    if verified.count == 1, let offset = verified.first {
      return .moved(
        offset: offset,
        statics: LongScreenshotStatics.detect(frame, reference, offset: offset, known: known))
    }
    guard verified.isEmpty else { return .unmatched }
    return isStill(frame, reference, known: known) ? .still : .unmatched
  }

  /// The rows of a band of `rows` that can move: all but the known header and footer, which
  /// never take more than leaves two overlaps.
  static func movingRegion(rows: Int, known: Static) -> Range<Int> {
    let top = max(0, known.top)
    let bottom = max(0, known.bottom)
    guard top + bottom <= rows - 2 * minimumOverlap else { return 0..<rows }
    return top..<(rows - bottom)
  }

  /// The segments outside known fixed left and right side columns; all segments if none remain.
  static func movingSegments(segments: Int, columns: Int, known: Static) -> Range<Int> {
    guard segments > 0, columns > 0 else { return 0..<max(0, segments) }
    let leftLimit = max(0, known.left)
    let rightStart = columns - max(0, known.right)
    var lower = 0
    while lower < segments,
      leftLimit > 0,
      LongScreenshotSignature.segmentColumns(lower, of: segments, columns: columns).upperBound
        <= leftLimit
    {
      lower += 1
    }
    var upper = segments
    while upper > lower,
      known.right > 0,
      LongScreenshotSignature.segmentColumns(upper - 1, of: segments, columns: columns).lowerBound
        >= rightStart
    {
      upper -= 1
    }
    return lower < upper ? lower..<upper : 0..<segments
  }

  /// The most voted non-zero offsets across active moving segments, skipping cells unchanged in
  /// place, strongest first, at most ``candidates`` distinct peaks.
  private static func strongestOffsets(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, region: Range<Int>,
    movingSegs: Range<Int>
  ) -> [Int] {
    let rows = frame.rows
    let segments = frame.segments
    let reach = region.count - minimumOverlap
    guard rows > 0, segments > 0, reach > 0, !movingSegs.isEmpty else { return [] }
    let regLo = Int32(region.lowerBound)
    let regHi = Int32(region.upperBound)
    let segLo = movingSegs.lowerBound
    let segHi = movingSegs.upperBound
    let mask = reference.indexMask
    var votes = [Int32](repeating: 0, count: 2 * rows + 1)
    var hits: [(offset: Int, votes: Int32)] = []

    frame.votesSample.withUnsafeBufferPointer { sBuf in
      frame.cells.withUnsafeBufferPointer { fcBuf in
        reference.cells.withUnsafeBufferPointer { rcBuf in
          reference.indexKeys.withUnsafeBufferPointer { rkBuf in
            reference.indexRows.withUnsafeBufferPointer { rrBuf in
              votes.withUnsafeMutableBufferPointer { vBuf in
                guard let sPtr = sBuf.baseAddress else { return }
                let fCells = fcBuf.baseAddress!
                let rCells = rcBuf.baseAddress!
                let rKeys = rkBuf.baseAddress!
                let rRows = rrBuf.baseAddress!
                let vPtr = vBuf.baseAddress!
                let count = sBuf.count
                var i = 0
                while i < count {
                  let entry = sPtr[i]
                  let seg = Int(entry.segment)
                  let row = entry.row
                  if seg >= segLo, seg < segHi, row >= regLo, row < regHi {
                    let cellIdx = Int(row) &* segments &+ seg
                    if fCells[cellIdx] != rCells[cellIdx] {
                      let k = entry.key
                      var slot = entry.hash & mask
                      while true {
                        let match = rRows[slot]
                        if match == -1 { break }
                        if rKeys[slot] == k {
                          if match >= regLo, match < regHi {
                            vPtr[Int(match &- row) &+ rows] &+= 1
                          }
                          break
                        }
                        slot = (slot &+ 1) & mask
                      }
                    }
                  }
                  i &+= 1
                }
                let minV = Int32(minimumVotes)
                var off = -reach
                while off <= reach {
                  if off != 0 {
                    let v = vPtr[off &+ rows]
                    if v > minV { hits.append((off, v)) }
                  }
                  off &+= 1
                }
              }
            }
          }
        }
      }
    }
    guard !hits.isEmpty else { return [] }
    hits.sort { $0.votes > $1.votes }
    var peaks: [Int] = []
    for hit in hits where peaks.count < candidates {
      if peaks.allSatisfy({ abs($0 - hit.offset) > peakWidth }) { peaks.append(hit.offset) }
    }
    return peaks
  }
}
