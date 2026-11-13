import CoreGraphics
import Foundation

/// How Atd's own scrolling paces itself during a long screenshot (decision D4): a closed loop on
/// what the stitched frames show, not on what was asked for.
///
/// A step aims to move the page ``share`` of the band's moving part (the rows between a sticky
/// header and a pinned footer), sized by the page's *gain*: the rows it moved per row asked for
/// so far, since an app may scroll more or less than a wheel event says, or animate it. The next
/// step waits until the frames show the page answered the last one: it moved
/// ``answeredShare`` of what was expected, or it moved and came to rest. At most the rest of one
/// step and the whole of the next are ever unseen, so consecutive frames keep overlapping however
/// the app scrolls. The first step waits for the page to come to rest, or to go as far as
/// expected, so the gain is known before steps overlap.
///
/// A frame that matches nothing (the page repainting, an image loading, a header folding away)
/// pauses the loop without ending it: stitching resumes with the next frame that matches. Only
/// once stitching has lost the page (``LongScreenshotStitch/lost``) does the loop scroll back, in
/// small steps, until a frame matches again, and then go on with smaller steps; it gives up after
/// ``recoveryLimit`` moving parts. A step the page does not answer is posted again after
/// ``answerWait``. The page's end is the stitch's (``LongScreenshotEdges``) with the latest step
/// unanswered, so a page that was already at its end, or loaded more since, is tried once more.
///
/// Times are seconds on the stitch's clock.
public struct LongScreenshotAutoScroll: Sendable {
  /// What the loop reads from the stitch before each decision.
  public struct Observation: Equatable, Sendable {
    /// The first frame is stitched; nothing else counts before it.
    public var started: Bool
    /// The latest matched frame's position in document rows.
    public var position: Int
    /// The band's moving part in rows.
    public var movingRows: Int
    /// The stream's pixels per point.
    public var scale: CGFloat
    /// The latest frame matched nothing (``LongScreenshotStitch/isAdrift``).
    public var adrift: Bool
    public var lost: LongScreenshotDirection?
    public var reachedEnd: Bool
    public var reachedLimit: Bool

    public init(
      started: Bool, position: Int = 0, movingRows: Int = 0, scale: CGFloat = 1,
      adrift: Bool = false, lost: LongScreenshotDirection? = nil, reachedEnd: Bool = false,
      reachedLimit: Bool = false
    ) {
      self.started = started
      self.position = position
      self.movingRows = movingRows
      self.scale = scale
      self.adrift = adrift
      self.lost = lost
      self.reachedEnd = reachedEnd
      self.reachedLimit = reachedLimit
    }
  }

  public enum Action: Equatable, Sendable {
    case wait
    /// Post one scroll of `points` towards `direction` (down: towards the page's end).
    case scroll(LongScreenshotDirection, points: CGFloat)
    case stop(Stop)
  }

  public enum Stop: Equatable, Sendable {
    /// The image holds the page's end and the page did not answer the latest step.
    case end
    /// The image is as long as it can be.
    case limit
    /// Stitching lost the page and scrolling back did not find it again.
    case lost
    /// The page answered nothing for ``unansweredLimit`` without an end being seen.
    case unanswered
    /// The first frame never came.
    case noFrames
  }

  /// The share of the moving part the first step aims for, and later ones once the gain is known.
  static let firstShare = 0.2
  static let share = 0.33
  /// Each recovery from a lost page cuts the share by ``backoff``, down to ``minimumShare``.
  static let backoff = 0.6
  static let minimumShare = 0.12
  /// Steps in points whatever the band: a smaller one may move a line-scrolling app not at all.
  static let stepRange: ClosedRange<CGFloat> = 24...120
  /// The gains a measurement is kept within.
  static let gainRange = 0.25...4.0
  /// A step that moved this share of what was expected is answered, once the gain is measured.
  static let answeredShare = 0.5
  /// A step that moved and then showed no new position for this long came to rest.
  static let settleWait = 0.2
  /// A step that moved nothing for this long went unanswered and is posted again.
  static let answerWait = 0.5
  /// A step still moving after this long is done with, unmeasured.
  static let stepTimeout = 1.2
  /// Scrolling back: each step aims for this share of the moving part, waits this long for a
  /// match, and all of them together go at most ``recoveryLimit`` moving parts.
  static let recoveryShare = 0.25
  static let recoveryWait = 0.3
  static let recoveryLimit = 2.0
  static let unansweredLimit = 3.0
  static let startupWait = 2.0

  private struct Step {
    let direction: LongScreenshotDirection
    let at: Double
    let from: Int
    /// Rows asked for: points times the scale.
    let rows: Double
    /// The furthest position seen when it was posted.
    let farthest: Int
  }

  private enum Outcome {
    case pending
    /// The page moved `rows`; `measured` when the move tells the gain (it came to rest, or went
    /// further than expected).
    case answered(rows: Int, measured: Bool)
    case unanswered
  }

  private let startedAt: Double
  private var gain = 1.0
  private var measured = false
  private var share = firstShare
  private var step: Step?
  private var position: Int?
  private var changedAt = 0.0
  private var farthest = Int.min
  /// When the first step the page has not answered yet was posted.
  private var quietSince: Double?
  /// Rows scrolled back, as expected to move, since stitching lost the page.
  private var backtracked = 0.0

  public init(at time: Double) {
    startedAt = time
  }

  /// What to do now, given what the stitch shows at `time`. A `.scroll` is taken as posted then.
  public mutating func next(_ seen: Observation, at time: Double) -> Action {
    guard seen.started else {
      return time - startedAt >= Self.startupWait ? .stop(.noFrames) : .wait
    }
    if seen.reachedLimit { return .stop(.limit) }
    note(seen.position, at: time)
    if let lost = seen.lost { return backtrack(from: lost, seen, at: time) }
    if backtracked > 0 {
      // A frame matched again after scrolling back: go on, more carefully.
      backtracked = 0
      step = nil
      quietSince = nil
      share = max(Self.minimumShare, share * Self.backoff)
    }
    if seen.adrift { return .wait }
    if let step {
      switch outcome(of: step, seen, at: time) {
      case .pending:
        return .wait
      case .answered(let rows, let measured):
        quietSince = nil
        if measured { learn(rows, of: step) }
        if seen.reachedEnd, seen.position <= step.farthest { return .stop(.end) }
      case .unanswered:
        if seen.reachedEnd { return .stop(.end) }
      }
    }
    if let quietSince, time - quietSince >= Self.unansweredLimit { return .stop(.unanswered) }
    return post(.down, aiming: Double(seen.movingRows) * share, seen, at: time)
  }

  // MARK: Private

  private mutating func note(_ seen: Int, at time: Double) {
    if seen != position {
      position = seen
      changedAt = time
    }
    farthest = max(farthest, seen)
  }

  private func outcome(of step: Step, _ seen: Observation, at time: Double) -> Outcome {
    let moved = step.direction == .down ? seen.position - step.from : step.from - seen.position
    let expected = step.rows * gain
    let elapsed = time - step.at
    if Double(moved) >= expected * (measured ? Self.answeredShare : 1) {
      return .answered(rows: moved, measured: Double(moved) >= expected)
    }
    if moved > 0, time - changedAt >= Self.settleWait {
      return .answered(rows: moved, measured: true)
    }
    if moved <= 0, elapsed >= Self.answerWait { return .unanswered }
    if elapsed >= Self.stepTimeout { return .answered(rows: moved, measured: false) }
    return .pending
  }

  private mutating func learn(_ moved: Int, of step: Step) {
    guard moved > 0, step.rows > 0 else { return }
    let sample = min(
      max(Double(moved) / step.rows, Self.gainRange.lowerBound), Self.gainRange.upperBound)
    gain = measured ? (gain + sample) / 2 : sample
    if !measured { share = max(share, Self.share) }
    measured = true
  }

  /// Scrolls back towards what is stitched, a small step at a time, until a frame matches.
  private mutating func backtrack(
    from lost: LongScreenshotDirection, _ seen: Observation, at time: Double
  ) -> Action {
    let back = lost.opposite
    if let step, step.direction == back, time - step.at < Self.recoveryWait { return .wait }
    let moving = Double(seen.movingRows)
    guard backtracked < moving * Self.recoveryLimit else { return .stop(.lost) }
    let action = post(back, aiming: moving * Self.recoveryShare, seen, at: time)
    backtracked += (step?.rows ?? 0) * gain
    return action
  }

  /// Records a step towards `direction` that aims to move the page `rows`, and asks for it.
  private mutating func post(
    _ direction: LongScreenshotDirection, aiming rows: Double, _ seen: Observation,
    at time: Double
  ) -> Action {
    let scale = Double(max(seen.scale, 1))
    let wanted = CGFloat(rows / gain / scale)
    let points = min(max(wanted, Self.stepRange.lowerBound), Self.stepRange.upperBound).rounded()
    step = Step(
      direction: direction, at: time, from: seen.position, rows: Double(points) * scale,
      farthest: farthest)
    if direction == .down, quietSince == nil { quietSince = time }
    return .scroll(direction, points: points)
  }
}
