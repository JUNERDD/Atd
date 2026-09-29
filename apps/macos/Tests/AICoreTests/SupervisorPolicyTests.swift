import Synchronization
import Testing

@testable import AICore

/// A clock that only moves when a test advances it.
final class ManualClock: Clock, Sendable {
  struct Instant: InstantProtocol {
    var offset: Duration
    func advanced(by duration: Duration) -> Instant { Instant(offset: offset + duration) }
    func duration(to other: Instant) -> Duration { other.offset - offset }
    static func < (lhs: Instant, rhs: Instant) -> Bool { lhs.offset < rhs.offset }
  }

  private let current = Mutex(Instant(offset: .zero))
  var now: Instant { current.withLock { $0 } }
  var minimumResolution: Duration { .nanoseconds(1) }

  func advance(by duration: Duration) {
    current.withLock { $0 = $0.advanced(by: duration) }
  }

  func sleep(until deadline: Instant, tolerance: Duration?) async throws {
    advance(by: now.duration(to: deadline))
  }
}

@Suite("Service supervisor policy")
struct SupervisorPolicyTests {
  @Test("The third unexpected exit within five minutes gives up")
  func breakerTrips() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    policy.serviceBecameLive()
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    clock.advance(by: .seconds(30))
    policy.serviceBecameLive()
    #expect(policy.unexpectedExit() == .restart(after: .seconds(1)))
    clock.advance(by: .seconds(30))
    #expect(policy.unexpectedExit() == .giveUp)
  }

  @Test("Backoff doubles from 500 ms and caps at 15 s")
  func backoffCurve() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    var delays: [SupervisorDecision] = []
    for _ in 0..<8 {
      // Spaced past the breaker window and never live for the healthy uptime.
      clock.advance(by: .seconds(301))
      delays.append(policy.unexpectedExit())
    }
    let expected: [Duration] = [
      .milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(15),
      .seconds(15), .seconds(15),
    ]
    #expect(delays == expected.map { .restart(after: $0) })
  }

  @Test("Exits exactly one window old are forgotten")
  func windowBoundary() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    clock.advance(by: .seconds(120))
    #expect(policy.unexpectedExit() == .restart(after: .seconds(1)))
    clock.advance(by: .seconds(180))
    #expect(policy.unexpectedExit() == .restart(after: .seconds(2)))
  }

  @Test("A service live for the healthy uptime resets the backoff but not the breaker")
  func healthyUptime() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    policy.serviceBecameLive()
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    policy.serviceBecameLive()
    clock.advance(by: .seconds(60))
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    policy.serviceBecameLive()
    clock.advance(by: .seconds(61))
    #expect(policy.unexpectedExit() == .giveUp)
  }

  @Test("A shorter uptime keeps the backoff growing")
  func unhealthyUptime() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    policy.serviceBecameLive()
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    clock.advance(by: .seconds(301))
    policy.serviceBecameLive()
    clock.advance(by: .seconds(59))
    #expect(policy.unexpectedExit() == .restart(after: .seconds(1)))
  }

  @Test("A respawn that fails before going live counts as an exit and never resets")
  func failedRespawn() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    policy.serviceBecameLive()
    clock.advance(by: .seconds(120))
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    clock.advance(by: .seconds(120))
    #expect(policy.unexpectedExit() == .restart(after: .seconds(1)))
  }

  @Test("Giving up keeps the history; a manual restart clears it")
  func manualReset() {
    let clock = ManualClock()
    var policy = SupervisorPolicy(clock: clock)
    for _ in 0..<2 { _ = policy.unexpectedExit() }
    #expect(policy.unexpectedExit() == .giveUp)
    #expect(policy.unexpectedExit() == .giveUp)
    policy.reset()
    #expect(policy.unexpectedExit() == .restart(after: .milliseconds(500)))
    #expect(policy.unexpectedExit() == .restart(after: .seconds(1)))
  }

  @Test("Limits mirror the Electron supervisor")
  func limits() {
    #expect(SupervisorLimits.backoffStart == .milliseconds(500))
    #expect(SupervisorLimits.backoffMax == .seconds(15))
    #expect(SupervisorLimits.healthyUptime == .seconds(60))
    #expect(SupervisorLimits.breakerWindow == .seconds(300))
    #expect(SupervisorLimits.breakerExits == 3)
  }
}
