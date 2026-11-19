import CryptoKit
import Darwin
import Foundation

/// Deterministic, ReDoS-free 5-pass privacy scrubber with Fail-Closed omission (`04` §3).
///
/// - Uses `String(decoding:as: UTF8.self)` so stray non-UTF-8 stderr bytes become `U+FFFD` rather
///   than failing whole-file decoding.
/// - Parses `.json` and `.jsonl` records first, scrubbing only string leaves and redacting secret
///   key names (`D5_json_secret_kv`) before re-serializing valid JSON.
/// - Runs free-text passes in strict order:
///   `Pass C (URLs/Figma/presigned/userinfo) -> Pass A (anchors) -> Pass B (paths) -> Pass D (tokens/keys/headers/emails) -> Pass E (4,077 B + "…[truncated:4KiB]" = 4,096 B)`.
/// - Drops the entire file's bytes (`omitted_redaction_error`) if the `250ms` thread CPU budget
///   (`CLOCK_THREAD_CPUTIME_ID`) expires or post-scrub structural validation fails.
public nonisolated enum DiagnosticsScrubber {
  public enum ScrubKind: Sendable {
    case json
    case jsonl
    case plainText
  }

  public enum ScrubbedFileOutcome: Equatable, Sendable {
    case included(bytes: Data, sha256: String, redactionHits: Int, durationMs: Int)
    case omitted(status: BundleFileStatus, errorCode: ScrubberAbortReason, durationMs: Int)
  }

  public static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  /// Scrubs a full candidate file with a hard per-file CPU budget (`250ms` default, measured via
  /// `CLOCK_THREAD_CPUTIME_ID` so OS thread preemption never causes false budget drops) and
  /// Fail-Closed drop semantics.
  public static func scrubFile(
    path: String,
    rawBytes: Data,
    kind: ScrubKind,
    anchors: EnvironmentAnchors = .current,
    budget: Duration = .milliseconds(250)
  ) -> ScrubbedFileOutcome {
    let startCpuNs = clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)
    let deadlineCpuNs = startCpuNs &+ durationToNanoseconds(budget)
    do {
      let (bytes, hits) = try runPipeline(
        rawBytes: rawBytes, kind: kind, anchors: anchors, deadlineCpuNs: deadlineCpuNs)
      return .included(
        bytes: bytes,
        sha256: sha256Hex(bytes),
        redactionHits: hits,
        durationMs: elapsedCpuMilliseconds(since: startCpuNs))
    } catch let reason as ScrubberAbortReason {
      return .omitted(
        status: .omittedRedactionError,
        errorCode: reason,
        durationMs: elapsedCpuMilliseconds(since: startCpuNs))
    } catch {
      return .omitted(
        status: .omittedRedactionError,
        errorCode: .scrubberException,
        durationMs: elapsedCpuMilliseconds(since: startCpuNs))
    }
  }

  /// Scrubs an in-memory multi-line or single-line text value using the 5-pass free-text pipeline.
  public static func scrubText(
    _ text: String, anchors: EnvironmentAnchors = .current
  ) -> (text: String, redactionHits: Int) {
    guard !text.isEmpty else { return ("", 0) }
    if !text.utf8.contains(0x0A) {
      var hits = 0
      var pemSkip = 0
      if let folded = DiagnosticsScrubberFastScan.foldPemLine(
        text, remainingSkip: &pemSkip, hits: &hits)
      {
        return (folded, hits)
      }
      let single = DiagnosticsScrubberRules.scrubSingleLine(
        text, anchors: anchors, enforce4KiBCap: true)
      return (single.text, single.hits)
    }

    let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    var out: [String] = []
    out.reserveCapacity(lines.count)
    var hits = 0
    var pemRemaining = 0
    for line in lines {
      if let folded = DiagnosticsScrubberFastScan.foldPemLine(
        line, remainingSkip: &pemRemaining, hits: &hits)
      {
        out.append(folded)
        continue
      }
      if pemRemaining > 0 { continue }
      let scrubbed = DiagnosticsScrubberRules.scrubSingleLine(
        line, anchors: anchors, enforce4KiBCap: true)
      out.append(scrubbed.text)
      hits += scrubbed.hits
    }
    return (out.joined(separator: "\n"), hits)
  }

  /// Scrubs a short single-line status/startup summary for `ServiceUnavailableDescriptor` and UI
  /// surfaces (`maxUTF8Bytes = 170` default so `<code-prefix>: <summary>` stays `<= 200` bytes).
  public static func scrubInlineSummary(
    _ raw: String,
    maxUTF8Bytes: Int = 170,
    anchors: EnvironmentAnchors = .current
  ) -> String {
    let flattened =
      raw
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    guard !flattened.isEmpty, maxUTF8Bytes > 0 else { return "" }
    let (scrubbed, _) = DiagnosticsScrubberRules.scrubSingleLine(
      flattened, anchors: anchors, enforce4KiBCap: true)
    guard scrubbed.utf8.count > maxUTF8Bytes else { return scrubbed }
    if maxUTF8Bytes <= 3 {
      return DiagnosticsScrubberRules.truncateUTF8(
        scrubbed, maxPrefixBytes: maxUTF8Bytes, suffix: "")
    }
    return DiagnosticsScrubberRules.truncateUTF8(
      scrubbed, maxPrefixBytes: maxUTF8Bytes - 3, suffix: "…")
  }

  static func checkDeadline(_ deadlineCpuNs: UInt64) throws {
    if Task.isCancelled || clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID) >= deadlineCpuNs {
      throw ScrubberAbortReason.cpuBudgetExceeded
    }
  }

  private static func durationToNanoseconds(_ budget: Duration) -> UInt64 {
    let sec = budget.components.seconds
    let atto = budget.components.attoseconds
    if sec < 0 || (sec == 0 && atto <= 0) { return 0 }
    if sec >= 3_600 { return 3_600_000_000_000 }
    let secNs = UInt64(sec) * 1_000_000_000
    let subNs = atto > 0 ? UInt64(atto / 1_000_000_000) : 0
    return secNs &+ subNs
  }

  private static func elapsedCpuMilliseconds(since startCpuNs: UInt64) -> Int {
    let nowNs = clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)
    guard nowNs > startCpuNs else { return 0 }
    return Int(((nowNs - startCpuNs) + 500_000) / 1_000_000)
  }
}
