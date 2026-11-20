import CoreGraphics
import Foundation

/// The stitched range of a long screenshot: which stretch of the page it holds, where the latest
/// frame sits in it, and what each new frame adds (decisions D3, D6).
///
/// Positions are *document rows*: the first frame's band row `r` is document row `r`, and a
/// frame at position `p` shows document rows `p + r` in its band's moving part (between the
/// sticky header and the pinned footer). The first frame provides the moving rows it shows;
/// rows above and below them come from later frames as *strips* the shell copies out of those
/// frames, above (growing up) and below (growing down). Header, footer and side columns are
/// drawn once from the first frame (``layout``).
///
/// Frames are matched against the latest frame that matched; failing that, against the one that
/// matched before it (the latest may itself be a frame caught mid-repaint that barely matched),
/// and the frames at the two ends of what is stitched (the lowest and the highest position), so
/// scrolling back to either end picks stitching up again. A frame that matches nothing while the
/// page is scrolled leaves stitching *adrift* (``isAdrift``): a frame caught mid-repaint, an image
/// loading or a header folding away matches nothing too, so stitching is only ``lost`` once frames
/// have matched nothing for ``lostAfter``. How the rows grow, the page's edges and the image's
/// limit are in `LongScreenshotStitch+Growth.swift`.
public struct LongScreenshotStitch: Sendable {
  public typealias Edge = LongScreenshotEdges.Edge

  /// What the shell does after describing a frame, an idle frame or the passing of time.
  public struct Update: Equatable, Sendable {
    /// Band-relative rows of the current frame (or the previous matched area) to add above or
    /// below the stitched rows, top to bottom.
    public var above: Range<Int>?
    public var below: Range<Int>?
    public var previousAbove: Range<Int>?
    public var previousBelow: Range<Int>?
    /// The page's edge lay inside what was stitched (an elastic overshoot): strips keep only the
    /// document rows from `keepFrom` and those before `keepBefore`.
    public var keepFrom: Int?
    public var keepBefore: Int?
    /// The page reached this edge: when the geometry has rows past the band on that side, the
    /// shell keeps them from the latest frame as the head or the tail.
    public var reached: Edge?
    /// The page grew past an edge it had reached (content loaded there): the head or tail kept
    /// at it goes, as stitching resumes past it.
    public var dropsHead = false
    public var dropsTail = false

    public init() {}

    public var isEmpty: Bool { self == Update() }
  }

  struct Reference: Sendable {
    let signature: LongScreenshotSignature
    let area: LongScreenshotSignature?
    let position: Int
  }

  public let geometry: LongScreenshotGeometry
  /// The sticky header and pinned footer as moving pairs have shown them, the smallest seen (a
  /// row that moved in any pair is not static); nil before the page first moved.
  public internal(set) var statics: LongScreenshotMatcher.Static?
  var areaStatics: LongScreenshotMatcher.Static?
  /// Each side's fixed columns: how many pairs saw some, and the fewest any of them saw. A side
  /// counts once two pairs saw it; a pair that saw none there proves nothing (its segments may
  /// have been blank).
  var leftSide = (pairs: 0, columns: 0)
  var rightSide = (pairs: 0, columns: 0)
  /// The latest matched frame's position.
  public internal(set) var position = 0
  /// Document rows held as strips above the first frame's rows, and below them.
  public internal(set) var stripsAbove: Range<Int>?
  public internal(set) var stripsBelow: Range<Int>?
  public internal(set) var lost: LongScreenshotDirection?
  /// Since when frames have matched nothing while the page was scrolled, and where it was most
  /// likely heading: what becomes ``lost`` after ``lostAfter``.
  var drift: (since: Double, heading: LongScreenshotDirection)?
  public private(set) var scrolled = false
  /// The image holds the page's end, or its start, until the page grows past it.
  public internal(set) var reachedEnd = false
  public internal(set) var reachedStart = false
  /// The image is as tall as it may be (``LongScreenshotGeometry/maxRows``): nothing more is
  /// stitched either way. Stays.
  public internal(set) var reachedLimit = false
  /// The page reached its start with rows of the scroll area above the band that fit the image.
  public internal(set) var offersHead = false
  /// Off until asked, so the image starts where the selection does.
  public var includesHead = false
  /// The page reached its end with rows of the scroll area below the band that fit the image:
  /// the shell keeps them, and they join the image while ``includesTail``.
  public internal(set) var offersTail = false
  /// The user's choice to add the rows below the band once the page's end is reached; off until
  /// they ask, so the image ends where the selection does.
  public var includesTail = false
  /// Where the latest frame was when each edge was reached.
  var endPosition: Int?
  var startPosition: Int?
  var current: Reference
  /// The frame that matched before ``current``; nil until a second one did.
  var previous: Reference?
  var low: Reference
  var high: Reference
  var waypoints: [Reference]
  var edges: LongScreenshotEdges
  var clamp = ClampState()
  var reversedWhileUnmatched = false

  /// Starts from the first frame. `scrollValue` is the scroll area's vertical value before the
  /// phase, when Accessibility reported one.
  public init(
    geometry: LongScreenshotGeometry, first: LongScreenshotSignature,
    firstArea: LongScreenshotSignature? = nil, scrollValue: Double?
  ) {
    self.geometry = geometry
    let reference = Reference(signature: first, area: firstArea, position: 0)
    current = reference
    low = reference
    high = reference
    waypoints = [reference]
    edges = LongScreenshotEdges(scrollValue: scrollValue)
  }

  /// How long frames may match nothing while the page is scrolled before stitching is lost.
  public static let lostAfter = 0.3

  /// The band's height in rows.
  public var bandHeight: Int { geometry.bandRows.count }
  /// The rows above or below the band are in the image.
  public var addedHead: Bool { offersHead && includesHead }
  public var addedTail: Bool { offersTail && includesTail }
  /// The latest frame matched nothing while the page was scrolled: stitching waits for one that
  /// does, and the page should not be scrolled further meanwhile.
  public var isAdrift: Bool { drift != nil }
  /// The static parts in use: none before the page first moved.
  public var applied: LongScreenshotMatcher.Static {
    var parts = statics ?? .none
    parts.left = leftSide.pairs >= 2 ? leftSide.columns : 0
    parts.right = rightSide.pairs >= 2 ? rightSide.columns : 0
    return parts
  }
  /// The moving part of the band, in band rows.
  public var movingRows: Range<Int> {
    LongScreenshotMatcher.movingRegion(rows: bandHeight, known: applied)
  }
  /// The stitched document rows.
  public var lo: Int { min(movingRows.lowerBound, stripsAbove?.lowerBound ?? .max) }
  public var hi: Int { max(movingRows.upperBound, stripsBelow?.upperBound ?? .min) }

  /// Someone asked the page to scroll `points` towards `direction` (down: towards its end).
  public mutating func request(
    _ direction: LongScreenshotDirection, points: CGFloat, auto: Bool, at time: Double
  ) {
    guard edges.request(direction, points: points, auto: auto, at: time) else { return }
    noteClampRequest(direction, points: points, auto: auto, at: time)
    if let heading = lost ?? drift?.heading, direction != heading {
      reversedWhileUnmatched = true
    }
  }

  /// A new complete frame.
  public mutating func add(
    _ frame: LongScreenshotSignature, area: LongScreenshotSignature? = nil,
    previousAreaPosition: Int? = nil, at time: Double
  ) -> Update {
    let matched = matchFrame(frame, area: area, at: time)
    let outcome = matched.outcome
    let reference = matched.reference
    let hasArea = area != nil
    var update = Update()
    switch outcome {
    case .moved(let offset, let pair):
      drift = nil
      resetClamp()
      if matched.matchedArea {
        adoptArea(pair)
        if abs(offset) <= movingRows.count - LongScreenshotMatcher.minimumOverlap {
          adopt(
            LongScreenshotStatics.detect(frame, reference.signature, offset: offset, known: applied)
          )
        }
      } else {
        adopt(pair)
        if let area, let refArea = reference.area {
          adoptArea(LongScreenshotStatics.detect(area, refArea, offset: offset, known: areaApplied))
        }
      }
      scrolled = true
      let newPosition = reference.position + offset
      let delta = newPosition - position
      edges.moved(delta, at: time)
      guard
        let grown = grow(
          at: newPosition, hasArea: hasArea, previousAreaPosition: previousAreaPosition)
      else {
        // It matched a frame, but lies past what is stitched: it waits, as a gap does.
        lost = delta >= 0 ? .down : .up
        return update
      }
      lost = nil
      reversedWhileUnmatched = false
      update = grown
      remember(Reference(signature: frame, area: area, position: newPosition))
    case .still:
      let delta = reference.position - position
      if delta != 0 {
        guard
          let grown = grow(
            at: reference.position, hasArea: hasArea, previousAreaPosition: previousAreaPosition)
        else {
          lost = delta > 0 ? .down : .up
          return update
        }
        resetClamp()
        update = grown
        if matched.reanchoredStill {
          edges.still(at: time)
        } else {
          edges.moved(delta, at: time)
        }
      } else {
        clearTransientClamp()
        edges.still(at: time)
      }
      lost = nil
      drift = nil
      reversedWhileUnmatched = false
      position = reference.position
      current = Reference(
        signature: reference.signature, area: reference.area ?? area, position: reference.position)
    case .unmatched:
      noteUnmatched(frame, at: time)
    }
    return update.merged(with: tick(at: time))
  }

  /// A frame ScreenCaptureKit reported as unchanged: the page still where the latest frame
  /// showed it, matched or not.
  public mutating func idle(at time: Double) -> Update {
    if lost == nil, drift == nil, clamp.probe == nil { edges.still(at: time) }
    return tick(at: time)
  }

  /// The passing of time: frames that kept matching nothing make stitching lost, and an
  /// unanswered request may now show an edge.
  public mutating func tick(at time: Double) -> Update {
    if let clamped = checkClamp(at: time) { return clamped }
    if lost == nil, let drift, time - drift.since >= Self.lostAfter {
      lost = drift.heading
      self.drift = nil
    }
    guard lost == nil, drift == nil, let edge = edges.edge(at: time) else { return Update() }
    return reach(edge)
  }
}
