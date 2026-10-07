import Foundation

/// How recently the person used the Mac (`SystemActivityReportSchema` in
/// packages/agent-contracts/src/system-activity.ts): the body of `POST /v1/system-activity`.
/// The service decides from it whether an idle automation may run, and treats a report older than
/// ``staleSeconds`` as unknown, which is never idle.
public struct SystemActivityReport: Encodable, Equatable, Sendable {
  /// How often the shell reports while connected (`SYSTEM_ACTIVITY_REPORT_SECONDS`).
  public static let reportSeconds = 60
  /// How long the service trusts a report (`SYSTEM_ACTIVITY_STALE_SECONDS`).
  public static let staleSeconds = 180
  /// The schema's `maximum`, a year.
  public static let maxIdleSeconds: Double = 31_536_000

  /// Seconds since the last keyboard, mouse or trackpad input in the login session.
  public let idleSeconds: Double

  /// Takes the system's reading as it is: a negative or non-finite value (a clock step, an API
  /// that has no answer) counts as just now, and a huge one is cut to the contract's maximum.
  public init(idleSeconds: Double) {
    if idleSeconds.isFinite {
      self.idleSeconds = min(max(idleSeconds, 0), Self.maxIdleSeconds)
    } else {
      self.idleSeconds = idleSeconds == .infinity ? Self.maxIdleSeconds : 0
    }
  }
}
