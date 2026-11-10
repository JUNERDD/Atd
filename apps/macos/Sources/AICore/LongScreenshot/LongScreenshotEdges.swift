import CoreGraphics
import Foundation

/// When a long screenshot's page has reached its end or its start (decision D6), from what the
/// frames show after someone asked it to scroll.
///
/// Two kinds of evidence count. An unanswered scroll: Atd or the user scrolled towards an edge
/// and the page did not move for a while (scrolling that stops on its own sends no more
/// requests, so it is never taken for an edge). A bounce: with elastic scrolling the page
/// overshoots its end and springs back, which no request explains, so a reversal nobody asked
/// for that then settles marks the edge it came back from. A frame that matches nothing cancels
/// a bounce and leaves the requests to the next frame that matches: one showing the page moved,
/// whichever way, answers them all, since it may have moved either way unseen; one showing it
/// where it was leaves them waiting, so a frame caught mid-repaint at an edge does not hide it.
/// Nothing shows an edge while frames match nothing. The Accessibility scroll value read before
/// the phase only shortens the wait at the edge it reports.
///
/// Times are seconds on one monotonic clock shared by frames and requests.
public struct LongScreenshotEdges: Sendable {
  public enum Edge: Equatable, Sendable { case start, end }

  /// How long an unanswered request waits, in seconds: the user's, Atd's own steps, and either
  /// at an edge the scroll value already reported. Atd's wait spans the step and the one it
  /// posts again (``LongScreenshotAutoScroll/answerWait``), so an app that was busy for a moment
  /// or dropped one event is not taken for the page's end.
  static let userWait = 0.5
  static let autoWait = 1.0
  static let hintedWait = 0.25
  /// The user's unanswered scrolling must add up to this many points; a stray tick is not a
  /// request to reach the end.
  static let userDistance: CGFloat = 32
  /// A settled bounce has shown no movement for this long.
  static let bounceSettle = 0.15
  /// Requests and movement older than this no longer explain what a frame shows.
  static let memory = 1.5

  private struct Pending: Sendable {
    var since: Double
    var points: CGFloat
    var auto: Bool
  }

  private var pending: [LongScreenshotDirection: Pending] = [:]
  private var lastRequest: (direction: LongScreenshotDirection, time: Double)?
  private var lastMovement: (direction: LongScreenshotDirection, time: Double)?
  /// The direction a reversal nobody asked for came back from, until the page settles.
  private var bounce: LongScreenshotDirection?
  private var stillSince: Double?
  /// A frame matched nothing since the latest one that did: whether the page moved meanwhile
  /// is unknown until a frame matches again.
  private var unseen = false
  private var hinted: Set<LongScreenshotDirection> = []

  /// `scrollValue` is the scroll area's vertical value before the phase, when known.
  public init(scrollValue: Double?) {
    if let scrollValue, scrollValue >= 0.995 { hinted.insert(.down) }
    if let scrollValue, scrollValue <= 0.005 { hinted.insert(.up) }
  }

  /// Someone asked the page to scroll `points` towards `direction`'s edge (down: its end).
  public mutating func request(
    _ direction: LongScreenshotDirection, points: CGFloat, auto: Bool, at time: Double
  ) {
    pending[direction.opposite] = nil
    var entry = pending[direction] ?? Pending(since: time, points: 0, auto: auto)
    entry.points += abs(points)
    entry.auto = entry.auto && auto
    pending[direction] = entry
    lastRequest = (direction, time)
  }

  /// A frame showed the page `offset` rows further down (up when negative).
  public mutating func moved(_ offset: Int, at time: Double) {
    guard offset != 0 else { return still(at: time) }
    let direction: LongScreenshotDirection = offset > 0 ? .down : .up
    if unseen {
      pending = [:]
      unseen = false
    } else {
      pending[direction] = nil
    }
    hinted.remove(direction)
    // Springing back from an edge: the latest request went the other way, towards that edge,
    // and so did the page just before. Without a request (a dragged scroll bar) a reversal is
    // only a reversal. A spring back spans several frames; the bounce stands while it goes on.
    let towardsEdge = lastRequest.map {
      $0.direction == direction.opposite && time - $0.time < Self.memory
    }
    let springing = bounce == direction.opposite && lastMovement?.direction == direction
    if towardsEdge == true, let previous = lastMovement, previous.direction == direction.opposite,
      time - previous.time < Self.memory
    {
      bounce = direction.opposite
    } else if !springing {
      bounce = nil
    }
    lastMovement = (direction, time)
    stillSince = nil
  }

  /// A frame showed the page where it was.
  public mutating func still(at time: Double) {
    unseen = false
    if stillSince == nil { stillSince = time }
  }

  /// A frame matched nothing: the page may have moved, so no bounce stands, and the requests
  /// wait for a frame that matches.
  public mutating func unmatched() {
    unseen = true
    bounce = nil
    stillSince = nil
  }

  /// The edge the evidence shows by `time`, once; nil while it shows none.
  public mutating func edge(at time: Double) -> Edge? {
    guard !unseen else { return nil }
    for direction in [LongScreenshotDirection.down, .up] {
      guard let entry = pending[direction] else { continue }
      let wait =
        hinted.contains(direction) ? Self.hintedWait : entry.auto ? Self.autoWait : Self.userWait
      guard time - entry.since >= wait, entry.auto || entry.points >= Self.userDistance else {
        continue
      }
      pending[direction] = nil
      return direction == .down ? .end : .start
    }
    if let bounce, let stillSince, time - stillSince >= Self.bounceSettle {
      self.bounce = nil
      return bounce == .down ? .end : .start
    }
    return nil
  }

  /// Whether a frame that matches nothing is the page moving too far (rather than changing in
  /// place): someone asked it to scroll, or it was just moving.
  public func isActive(at time: Double) -> Bool {
    (lastRequest.map { time - $0.time < Self.memory } ?? false)
      || (lastMovement.map { time - $0.time < Self.memory / 3 } ?? false)
  }

  /// Where the page was most likely heading: the latest request's direction, else the latest
  /// movement's, else down.
  public func heading(at time: Double) -> LongScreenshotDirection {
    if let lastRequest, time - lastRequest.time < Self.memory { return lastRequest.direction }
    return lastMovement?.direction ?? .down
  }
}

extension LongScreenshotDirection {
  public var opposite: LongScreenshotDirection { self == .down ? .up : .down }
}
