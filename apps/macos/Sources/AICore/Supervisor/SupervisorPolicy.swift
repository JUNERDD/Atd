/// Restart timing for the packaged service.
public enum SupervisorLimits {
  public static let backoffStart: Duration = .milliseconds(500)
  public static let backoffMax: Duration = .seconds(15)
  /// Uptime after which a restarted service counts as healthy and the backoff starts over.
  public static let healthyUptime: Duration = .seconds(60)
  /// ``breakerExits`` unexpected exits within this window stop automatic restarts.
  public static let breakerWindow: Duration = .seconds(5 * 60)
  public static let breakerExits = 3
}

public enum SupervisorDecision: Equatable, Sendable {
  /// Respawn the service after this delay.
  case restart(after: Duration)
  /// The breaker tripped: stop restarting and show the failure until a manual restart.
  case giveUp
}

/// The supervisor's decision state, free of processes and timers so it can be tested with a
/// manual clock. The owner reports what happened; the policy answers what to do.
///
/// Semantics:
/// - Supervision starts once a service came up; a failed first start is shown, not retried.
/// - An unexpected exit, or a respawn that fails before the service is live, counts as one
///   exit. Exits older than the window are forgotten; the third within it gives up.
/// - The n-th consecutive restart waits `500 ms × 2ⁿ`, capped at 15 s. A service that stayed
///   live for 60 s resets that count, not the breaker history.
/// - Giving up keeps the history; only a manual restart (``reset()``) clears both.
public struct SupervisorPolicy<C: Clock>: Sendable where C.Duration == Duration {
  private let clock: C
  /// Times of recent unexpected exits, for the breaker.
  private var exits: [C.Instant] = []
  /// Consecutive restarts since the service last stayed up for the healthy uptime.
  private var attempt = 0
  /// When the supervised service last became live (spawned and connected, or adopted).
  private var liveSince: C.Instant?

  public init(clock: C) {
    self.clock = clock
  }

  /// The service is up: a spawn connected, or a running service was adopted.
  public mutating func serviceBecameLive() {
    liveSince = clock.now
  }

  /// The supervised service exited unexpectedly, or a respawn failed.
  public mutating func unexpectedExit() -> SupervisorDecision {
    let now = clock.now
    if let liveSince, liveSince.duration(to: now) >= SupervisorLimits.healthyUptime {
      attempt = 0
    }
    liveSince = nil
    exits = exits.filter { $0.duration(to: now) < SupervisorLimits.breakerWindow } + [now]
    if exits.count >= SupervisorLimits.breakerExits { return .giveUp }
    let delay = min(
      SupervisorLimits.backoffStart * (1 << min(attempt, 30)), SupervisorLimits.backoffMax)
    attempt += 1
    return .restart(after: delay)
  }

  /// Manual restart: forgets the crash history and the backoff.
  public mutating func reset() {
    exits = []
    attempt = 0
    liveSince = nil
  }
}
