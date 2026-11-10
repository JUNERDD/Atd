import Foundation

/// How far the page under a long screenshot's band moved between two frames (decision D3), and
/// which parts of the band stayed in place while it moved.
///
/// The band's cells (``LongScreenshotSignature``) vote: each informative cell of the new frame
/// whose hash occurs exactly once in the reference's segment votes for the offset between the
/// two rows. The strongest offsets are then verified over the whole overlap of the moving part,
/// uniform cells included: a cell either agrees at the offset, stayed in place (a static part),
/// or is a mismatch, and the agreeing share must reach ``minimumScore``. Exactly one offset must
/// verify; two that do mean repeating content, and nothing is stitched, as for no overlap at all
/// ("never stitch a guess"). An offset of zero is not a movement: a frame that agrees in place is
/// ``Outcome/still``, which is how the page's ends are seen.
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
  /// Rows with an informative agreeing cell an offset needs: at least this many, and at least
  /// ``minimumEvidenceShare`` of the overlap's informative rows.
  public static let minimumEvidenceRows = 12
  public static let minimumEvidenceShare = 0.2
  /// The share of informative cells that must agree in place for a frame to be still.
  public static let minimumStillShare = 0.9
  /// Offsets voted for this many times or fewer are not worth verifying.
  static let minimumVotes = 6
  /// Offsets this close to a stronger one are the same peak.
  static let peakWidth = 2
  /// The strongest offsets verified.
  static let candidates = 3

  /// Compares `frame` with `reference`, both of the same band. `known` is what earlier pairs
  /// showed of the static parts; its rows are left out of the moving part.
  public static func match(
    _ frame: LongScreenshotSignature, to reference: LongScreenshotSignature, known: Static
  ) -> Outcome {
    guard frame.rows == reference.rows, frame.segments == reference.segments,
      frame.columns.count == reference.columns.count
    else { return .unmatched }
    let region = movingRegion(rows: frame.rows, known: known)
    let verified = strongestOffsets(frame, reference, region: region).filter {
      verifies(frame, reference, offset: $0, region: region)
    }
    if verified.count == 1, let offset = verified.first {
      return .moved(
        offset: offset,
        statics: LongScreenshotStatics.detect(frame, reference, offset: offset, known: known))
    }
    guard verified.isEmpty else { return .unmatched }
    return isStill(frame, reference) ? .still : .unmatched
  }

  /// The rows of a band of `rows` that can move: all but the known header and footer, which
  /// never take more than leaves two overlaps.
  static func movingRegion(rows: Int, known: Static) -> Range<Int> {
    let top = max(0, known.top)
    let bottom = max(0, known.bottom)
    guard top + bottom <= rows - 2 * minimumOverlap else { return 0..<rows }
    return top..<(rows - bottom)
  }

  /// The most voted non-zero offsets, strongest first, at most ``candidates`` distinct peaks.
  private static func strongestOffsets(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, region: Range<Int>
  ) -> [Int] {
    let segments = frame.segments
    // Each segment's row hashes that occur once in the reference; repeated ones (rules, table
    // borders) would vote for every offset at once.
    var unique: [UInt64: Int] = [:]
    unique.reserveCapacity(region.count * segments)
    for row in region {
      for segment in 0..<segments where reference.isInformative(row, segment) {
        let key = self.key(reference.cell(row, segment), segment)
        unique[key] = unique[key] == nil ? row : -1
      }
    }
    let rows = frame.rows
    var votes = [Int](repeating: 0, count: 2 * rows + 1)
    for row in region {
      for segment in 0..<segments where frame.isInformative(row, segment) {
        guard let match = unique[key(frame.cell(row, segment), segment)], match >= 0 else {
          continue
        }
        votes[match - row + rows] += 1
      }
    }
    let reach = region.count - minimumOverlap
    var order = votes.indices.filter { slot in
      let offset = slot - rows
      return offset != 0 && abs(offset) <= reach && votes[slot] > minimumVotes
    }
    order.sort { votes[$0] > votes[$1] }
    var peaks: [Int] = []
    for slot in order where peaks.count < candidates {
      let offset = slot - rows
      if peaks.allSatisfy({ abs($0 - offset) > peakWidth }) { peaks.append(offset) }
    }
    return peaks
  }

  /// Whether `offset` explains the moving part's overlap: enough agreeing cells overall, and
  /// enough rows with informative evidence. The worst segments (``spareSegments``) are set aside
  /// first: one straddling a fixed column's edge, or holding something that changes, agrees
  /// neither way, while a wrong offset fails in every segment.
  private static func verifies(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature, offset: Int,
    region: Range<Int>
  ) -> Bool {
    let overlap = region.clamped(to: (region.lowerBound - offset)..<(region.upperBound - offset))
    guard overlap.count >= minimumOverlap else { return false }
    let segments = frame.segments
    var agree = [Int](repeating: 0, count: segments)
    var mismatch = [Int](repeating: 0, count: segments)
    var evidenceRows = 0
    var informativeRows = 0
    for row in overlap {
      var evidence = false
      var informative = false
      for segment in 0..<segments {
        let cell = frame.cell(row, segment)
        let rich = frame.isInformative(row, segment)
        informative = informative || rich
        if cell == reference.cell(row + offset, segment) {
          agree[segment] += 1
          evidence = evidence || (rich && cell != reference.cell(row, segment))
        } else if cell != reference.cell(row, segment) {
          mismatch[segment] += 1
        }
      }
      if evidence { evidenceRows += 1 }
      if informative { informativeRows += 1 }
    }
    let kept = (0..<segments).sorted { mismatch[$0] - agree[$0] < mismatch[$1] - agree[$1] }
      .prefix(segments - spareSegments(segments))
    let agreeing = kept.reduce(0) { $0 + agree[$1] }
    let checked = agreeing + kept.reduce(0) { $0 + mismatch[$1] }
    let needed = max(
      minimumEvidenceRows, Int((Double(informativeRows) * minimumEvidenceShare).rounded(.up)))
    return checked > 0 && Double(agreeing) / Double(checked) >= minimumScore
      && evidenceRows >= needed
  }

  /// The segments verification may set aside: one in five, none when fewer than three.
  static func spareSegments(_ segments: Int) -> Int {
    segments < 3 ? 0 : max(1, segments / 5)
  }

  /// Whether `frame` shows the reference in place: most informative cells unchanged (a caret or
  /// a spinner may change), or every cell unchanged when none is informative.
  private static func isStill(
    _ frame: LongScreenshotSignature, _ reference: LongScreenshotSignature
  ) -> Bool {
    var informative = 0
    var same = 0
    var changed = false
    for index in frame.cells.indices {
      let equal = frame.cells[index] == reference.cells[index]
      changed = changed || !equal
      guard frame.informative[index] || reference.informative[index] else { continue }
      informative += 1
      if equal { same += 1 }
    }
    guard informative > 0 else { return !changed }
    return Double(same) / Double(informative) >= minimumStillShare
  }

  /// A cell's hash keyed by its segment, so a row only matches rows at the same columns.
  private static func key(_ hash: UInt64, _ segment: Int) -> UInt64 {
    hash &+ UInt64(segment) &* 0x9E37_79B9_7F4A_7C15
  }
}
