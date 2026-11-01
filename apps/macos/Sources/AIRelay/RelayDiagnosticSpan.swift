import AICore
import Foundation

/// Metadata-only observation of one relay attempt. No path parameters, queries, headers or body.
final class RelayDiagnosticSpan {
  private let correlation: Int
  private let started = ProcessInfo.processInfo.systemUptime
  private var ended = false
  private var bytes = 0

  init?(_ request: RelayedRequest, replayed: Bool) {
    guard SupportDiagnosticEvents.sink != nil else { return nil }
    let families: Set<String> = [
      "settings", "tasks", "runs", "providers", "models", "commands", "automations", "memory",
      "skills", "agents", "mcp", "apps", "addons", "resources", "artifacts", "status",
    ]
    let family = request.path.segments.dropFirst().first ?? ""
    let methods: Set<String> = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]
    correlation = SupportDiagnosticEvents.record(
      "relay.begin",
      details: [
        "family": .string(families.contains(family) ? family : "other"),
        "method": .string(methods.contains(request.method) ? request.method : "other"),
        "replayed": .bool(replayed),
        "requestBytes": .number(Double(request.body?.count ?? 0)),
      ])
  }

  func response(_ status: Int) {
    SupportDiagnosticEvents.record(
      "relay.response",
      details: [
        "status": .number(Double(status)), "elapsedMs": .number(elapsed),
      ], correlation: correlation)
  }

  func received(_ count: Int) { bytes += count }

  func finish(_ outcome: String, error: (any Error)? = nil) {
    guard !ended else { return }
    ended = true
    SupportDiagnosticEvents.record(
      "relay.end",
      details: [
        "outcome": .string(outcome), "elapsedMs": .number(elapsed),
        "responseBytes": .number(Double(bytes)),
        "errorCode": error.map { .number(Double(($0 as NSError).code)) } ?? .null,
      ], correlation: correlation)
  }

  private var elapsed: Double { (ProcessInfo.processInfo.systemUptime - started) * 1000 }
}
