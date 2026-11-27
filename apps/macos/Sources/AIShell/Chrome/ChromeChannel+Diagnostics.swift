import AIChromeChannelKit
import AICore
import Foundation

/// Per-session token bucket guarding paired `diag.batch` ingestion (`<= 64` entries/sec, burst
/// `128`). Excess entries are dropped silently without replying `.error` to avoid feedback loops.
struct ChromeDiagRateLimiter {
  static let refillPerSecond = 64.0
  static let burstCapacity = 128.0

  private var tokens: Double
  private var lastRefill: ContinuousClock.Instant
  private var pendingDrops = 0

  init(now: ContinuousClock.Instant = .now) {
    tokens = Self.burstCapacity
    lastRefill = now
  }

  /// Admits up to the available token count from `batch`. Returns `nil` when zero entries can be
  /// admitted so floods write nothing to disk while still tracking cumulative drops.
  mutating func admit(
    _ batch: ChromeDiagBatch, now: ContinuousClock.Instant = .now
  ) -> (entries: [ChromeDiagEntry], dropped: Int)? {
    let elapsed = lastRefill.duration(to: now)
    let seconds = max(
      0,
      Double(elapsed.components.seconds)
        + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000_000.0)
    if seconds > 0 {
      tokens = min(Self.burstCapacity, tokens + seconds * Self.refillPerSecond)
      lastRefill = now
    }

    let available = max(0, Int(tokens.rounded(.down)))
    let admittedCount = min(batch.entries.count, available)
    tokens -= Double(admittedCount)
    let rateDropped = batch.entries.count - admittedCount
    let batchDropped = max(0, batch.dropped ?? 0)
    let totalDropped = Self.saturatingAdd(
      pendingDrops, Self.saturatingAdd(batchDropped, rateDropped))

    guard admittedCount > 0 else {
      pendingDrops = totalDropped
      return nil
    }
    pendingDrops = 0
    return (Array(batch.entries.prefix(admittedCount)), totalDropped)
  }

  private static func saturatingAdd(_ lhs: Int, _ rhs: Int) -> Int {
    let (sum, overflow) = lhs.addingReportingOverflow(rhs)
    return overflow ? Int.max : sum
  }
}

extension ChromeChannel {
  static func profileHash(of installationId: String) -> String {
    ChromeExtensionLogWriter.profileHash(for: installationId)
  }

  func logShell(_ level: ShellLogWriter.Level, category: String, _ message: String) {
    environment.onShellLog(level, category, message)
  }

  /// Persists a paired session's `diag.batch` through its per-session token bucket.
  func handleDiagBatch(
    _ batch: ChromeDiagBatch, from session: ChromeSession, link: ChromeLink,
    now: ContinuousClock.Instant = .now
  ) {
    let key = ObjectIdentifier(session)
    var limiter = diagLimiters[key] ?? ChromeDiagRateLimiter(now: now)
    let admitted = limiter.admit(batch, now: now)
    diagLimiters[key] = limiter
    guard let admitted else { return }
    environment.onExtensionDiag(
      admitted.entries, Self.profileHash(of: link.installationId), admitted.dropped)
  }

  /// Logs key tab ownership transitions (`tab.handed`, `tab.openFailed`, `tab.released`) to
  /// `shell.log` with hashed profile id only (zero page URLs/titles/PII).
  func logInboundTabEvent(_ frame: ChromeInboundFrame, on link: ChromeLink) {
    let profile = Self.profileHash(of: link.installationId)
    switch frame {
    case .tabHanded(let runId, let tabId, let targetId):
      logShell(
        .info, category: "chrome",
        "tab_handed profile=\(profile) runId=\(runId) tabId=\(tabId) targetId=\(targetId)")
    case .tabOpenFailed(let requestId, let reason):
      let safeReason = DiagnosticsScrubber.scrubInlineSummary(reason, maxUTF8Bytes: 200)
      logShell(
        .error, category: "chrome",
        "tab_open_failed profile=\(profile) requestId=\(requestId) reason=\(safeReason)")
    case .tabReleased(let tabId, let reason):
      let level: ShellLogWriter.Level =
        (reason == .canceledByUser || reason == .detached) ? .warn : .info
      logShell(
        level, category: "chrome",
        "tab_released profile=\(profile) tabId=\(tabId) reason=\(reason.rawValue)")
    default:
      break
    }
  }
}
