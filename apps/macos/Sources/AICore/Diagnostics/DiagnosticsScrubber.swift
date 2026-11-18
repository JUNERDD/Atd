import CryptoKit
import Foundation

/// Deterministic, ReDoS-free 5-pass privacy scrubber with Fail-Closed omission (`04` §3).
///
/// - Uses `String(decoding:as: UTF8.self)` so stray non-UTF-8 stderr bytes become `U+FFFD` rather
///   than failing whole-file decoding.
/// - Parses `.json` and `.jsonl` records first, scrubbing only string leaves and redacting secret
///   key names (`D5_json_secret_kv`) before re-serializing valid JSON.
/// - Runs free-text passes in strict order:
///   `Pass C (URLs/Figma/presigned/userinfo) -> Pass A (anchors) -> Pass B (paths) -> Pass D (tokens/keys/headers/emails) -> Pass E (4,077 B + "…[truncated:4KiB]" = 4,096 B)`.
/// - Drops the entire file's bytes (`omitted_redaction_error`) if the `250ms` CPU budget expires or
///   post-scrub structural validation fails.
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

  /// Scrubs a full candidate file with a hard per-file CPU budget (`250ms` default) and Fail-Closed
  /// drop semantics.
  public static func scrubFile(
    path: String,
    rawBytes: Data,
    kind: ScrubKind,
    anchors: EnvironmentAnchors = .current,
    budget: Duration = .milliseconds(250)
  ) -> ScrubbedFileOutcome {
    let start = ContinuousClock.now
    let deadline = start.advanced(by: budget)
    do {
      let (bytes, hits) = try runPipeline(
        rawBytes: rawBytes, kind: kind, anchors: anchors, deadline: deadline)
      return .included(
        bytes: bytes,
        sha256: sha256Hex(bytes),
        redactionHits: hits,
        durationMs: elapsedMilliseconds(since: start))
    } catch let reason as ScrubberAbortReason {
      return .omitted(
        status: .omittedRedactionError,
        errorCode: reason,
        durationMs: elapsedMilliseconds(since: start))
    } catch {
      return .omitted(
        status: .omittedRedactionError,
        errorCode: .scrubberException,
        durationMs: elapsedMilliseconds(since: start))
    }
  }

  /// Scrubs an in-memory multi-line or single-line text value using the 5-pass free-text pipeline.
  public static func scrubText(
    _ text: String, anchors: EnvironmentAnchors = .current
  ) -> (text: String, redactionHits: Int) {
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    var out: [String] = []
    out.reserveCapacity(lines.count)
    var hits = 0
    var pemRemaining = 0
    for line in lines {
      if let folded = foldPemLine(line, remainingSkip: &pemRemaining, hits: &hits) {
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

  private static func runPipeline(
    rawBytes: Data,
    kind: ScrubKind,
    anchors: EnvironmentAnchors,
    deadline: ContinuousClock.Instant
  ) throws -> (Data, Int) {
    try checkDeadline(deadline)
    switch kind {
    case .json:
      return try scrubJsonDocument(rawBytes: rawBytes, anchors: anchors, deadline: deadline)
    case .jsonl:
      return try scrubJsonLines(rawBytes: rawBytes, anchors: anchors, deadline: deadline)
    case .plainText:
      return try scrubPlainTextLines(rawBytes: rawBytes, anchors: anchors, deadline: deadline)
    }
  }

  private static func scrubJsonDocument(
    rawBytes: Data, anchors: EnvironmentAnchors, deadline: ContinuousClock.Instant
  ) throws -> (Data, Int) {
    guard !rawBytes.isEmpty,
      let root = try? JSONSerialization.jsonObject(with: rawBytes, options: [.fragmentsAllowed])
    else { throw ScrubberAbortReason.utf8OrJsonInvalid }
    var hits = 0
    var stepCounter = 0
    let scrubbed = try scrubJsonNode(
      root, anchors: anchors, deadline: deadline, stepCounter: &stepCounter, hits: &hits)
    guard JSONSerialization.isValidJSONObject(scrubbed),
      let encoded = try? JSONSerialization.data(withJSONObject: scrubbed, options: [.sortedKeys]),
      !encoded.isEmpty
    else { throw ScrubberAbortReason.utf8OrJsonInvalid }
    try checkDeadline(deadline)
    return (encoded, hits)
  }

  private static func scrubJsonNode(
    _ node: Any,
    anchors: EnvironmentAnchors,
    deadline: ContinuousClock.Instant,
    stepCounter: inout Int,
    hits: inout Int
  ) throws -> Any {
    stepCounter &+= 1
    if (stepCounter & 0x3F) == 0 { try checkDeadline(deadline) }

    if let dict = node as? [String: Any] {
      var result: [String: Any] = [:]
      result.reserveCapacity(dict.count)
      for (key, value) in dict {
        let keyRange = NSRange(key.startIndex..., in: key)
        if DiagnosticsScrubberRules.secretJsonKeyRegex.firstMatch(in: key, range: keyRange) != nil {
          if value is NSNull {
            result[key] = value
          } else {
            result[key] = "<redacted>"
            hits += 1
          }
        } else {
          result[key] = try scrubJsonNode(
            value, anchors: anchors, deadline: deadline, stepCounter: &stepCounter, hits: &hits)
        }
      }
      return result
    }
    if let array = node as? [Any] {
      var result: [Any] = []
      result.reserveCapacity(array.count)
      for element in array {
        result.append(
          try scrubJsonNode(
            element, anchors: anchors, deadline: deadline, stepCounter: &stepCounter, hits: &hits))
      }
      return result
    }
    if let str = node as? String {
      let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.hasPrefix("{") && trimmed.hasSuffix("}"),
        str.utf8.count <= DiagnosticsScrubberRules.maxLineBytes,
        let nested = try? JSONSerialization.jsonObject(with: Data(str.utf8)),
        nested is [String: Any]
      {
        let cleanObj = try scrubJsonNode(
          nested, anchors: anchors, deadline: deadline, stepCounter: &stepCounter, hits: &hits)
        if let cleanData = try? JSONSerialization.data(
          withJSONObject: cleanObj, options: [.sortedKeys])
        {
          return String(decoding: cleanData, as: UTF8.self)
        }
      }
      let (clean, leafHits) = scrubText(str, anchors: anchors)
      hits += leafHits
      return clean
    }
    return node
  }

  private static func scrubJsonLines(
    rawBytes: Data, anchors: EnvironmentAnchors, deadline: ContinuousClock.Instant
  ) throws -> (Data, Int) {
    struct RawFallbackWrapper: Encodable {
      let rawScrubbed: String
      enum CodingKeys: String, CodingKey { case rawScrubbed = "raw_scrubbed" }
    }
    let encoder = JSONEncoder()
    var output = Data()
    output.reserveCapacity(min(rawBytes.count + 256, 1_048_576))
    var hits = 0
    var stepCounter = 0
    var pemRemaining = 0

    for (lineIdx, rawLine) in splitLines(rawBytes).enumerated() {
      if (lineIdx & 0x3F) == 0 { try checkDeadline(deadline) }
      guard !rawLine.isEmpty else { continue }
      let decoded = trimTrailingCR(String(decoding: rawLine, as: UTF8.self))
      guard !decoded.isEmpty else { continue }

      if let folded = foldPemLine(decoded, remainingSkip: &pemRemaining, hits: &hits) {
        output.append(try encoder.encode(RawFallbackWrapper(rawScrubbed: folded)))
        output.append(0x0A)
        continue
      }
      if pemRemaining > 0 { continue }

      if rawLine.count <= DiagnosticsScrubberRules.maxLineBytes,
        let parsed = try? JSONSerialization.jsonObject(with: Data(rawLine)),
        JSONSerialization.isValidJSONObject(parsed)
      {
        let cleanObj = try scrubJsonNode(
          parsed, anchors: anchors, deadline: deadline, stepCounter: &stepCounter, hits: &hits)
        guard
          let encoded = try? JSONSerialization.data(
            withJSONObject: cleanObj, options: [.sortedKeys])
        else { throw ScrubberAbortReason.utf8OrJsonInvalid }
        output.append(encoded)
        output.append(0x0A)
      } else {
        let (cleanLine, lineHits) = DiagnosticsScrubberRules.scrubSingleLine(
          decoded, anchors: anchors, enforce4KiBCap: true)
        hits += lineHits
        output.append(try encoder.encode(RawFallbackWrapper(rawScrubbed: cleanLine)))
        output.append(0x0A)
      }
    }
    try checkDeadline(deadline)
    return (output, hits)
  }

  private static func scrubPlainTextLines(
    rawBytes: Data, anchors: EnvironmentAnchors, deadline: ContinuousClock.Instant
  ) throws -> (Data, Int) {
    var output = Data()
    output.reserveCapacity(min(rawBytes.count + 128, 1_048_576))
    var hits = 0
    var pemRemaining = 0
    let slices = splitLines(rawBytes)
    for (idx, slice) in slices.enumerated() {
      if (idx & 0x3F) == 0 { try checkDeadline(deadline) }
      let decoded = trimTrailingCR(String(decoding: slice, as: UTF8.self))
      if let folded = foldPemLine(decoded, remainingSkip: &pemRemaining, hits: &hits) {
        output.append(contentsOf: folded.utf8)
        if idx < slices.count - 1 { output.append(0x0A) }
        continue
      }
      if pemRemaining > 0 { continue }
      let (clean, lineHits) = DiagnosticsScrubberRules.scrubSingleLine(
        decoded, anchors: anchors, enforce4KiBCap: true)
      hits += lineHits
      output.append(contentsOf: clean.utf8)
      if idx < slices.count - 1 { output.append(0x0A) }
    }
    try checkDeadline(deadline)
    return (output, hits)
  }

  private static func foldPemLine(
    _ line: String, remainingSkip: inout Int, hits: inout Int
  ) -> String? {
    if remainingSkip > 0 {
      remainingSkip = line.contains("-----END ") ? 0 : remainingSkip - 1
      return nil
    }
    guard
      line.contains("-----BEGIN ")
        && (line.contains("PRIVATE KEY") || line.contains("SECRET") || line.contains("CERTIFICATE"))
    else { return nil }
    hits += 1
    if !line.contains("-----END ") { remainingSkip = 128 }
    return "-----REDACTED PEM BLOCK-----"
  }

  private static func splitLines(_ data: Data) -> [Data.SubSequence] {
    data.isEmpty ? [] : data.split(separator: 0x0A, omittingEmptySubsequences: false)
  }

  private static func trimTrailingCR(_ line: String) -> String {
    line.hasSuffix("\r") ? String(line.dropLast()) : line
  }

  private static func checkDeadline(_ deadline: ContinuousClock.Instant) throws {
    if Task.isCancelled || ContinuousClock.now >= deadline {
      throw ScrubberAbortReason.cpuBudgetExceeded
    }
  }

  private static func elapsedMilliseconds(since start: ContinuousClock.Instant) -> Int {
    let elapsed = start.duration(to: ContinuousClock.now)
    let ms =
      Double(elapsed.components.seconds) * 1_000.0
      + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000.0
    return max(0, Int(ms.rounded()))
  }
}
