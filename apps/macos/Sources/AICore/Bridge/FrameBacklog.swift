/// When a page has fallen too far behind its stream sockets for the shell to keep buffering.
///
/// The shell takes each frame off the service's socket as soon as it arrives and queues it in the
/// web view's ``BridgeOutbox``, so the service never sees a slow page and its own slow-consumer
/// cutoff (`apps/agent-service/src/stream.ts`) never applies. This applies the same rule on the
/// shell's side: frames waiting above ``limitBytes`` for longer than ``grace`` mean the page is
/// stalled (a long synchronous render, a paused debugger, a hung page). Its sockets are then
/// closed, and the page's stream client reconnects and resumes from its last event once it runs
/// again, as after the service's cutoff. A single large frame or a short burst drains well within
/// the grace period.
///
/// The backlog holds no clock: its owner passes the time of each observation.
public struct FrameBacklog: Sendable {
  public static var defaultLimitBytes: Int { 16 * 1024 * 1024 }
  public static var defaultGrace: Duration { .seconds(10) }

  public let limitBytes: Int
  public let grace: Duration
  /// When the frames waiting first went above the limit, while they stay above it.
  private var overSince: ContinuousClock.Instant?

  public init(limitBytes: Int = Self.defaultLimitBytes, grace: Duration = Self.defaultGrace) {
    self.limitBytes = limitBytes
    self.grace = grace
  }

  /// Records the bytes waiting at `now`; true once they have stayed above the limit for the
  /// grace period. The backlog then starts over, so the sockets close once per stall.
  public mutating func exceeded(pendingBytes: Int, at now: ContinuousClock.Instant) -> Bool {
    guard pendingBytes > limitBytes else {
      overSince = nil
      return false
    }
    guard let since = overSince else {
      overSince = now
      return false
    }
    guard now - since >= grace else { return false }
    overSince = nil
    return true
  }
}
