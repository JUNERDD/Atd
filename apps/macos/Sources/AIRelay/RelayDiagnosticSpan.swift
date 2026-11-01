import AICore
import Foundation

/// Metadata-only observation of one relay attempt. No path parameters, queries, headers or body.
/// An in-flight request never carries its correlation into a replacement recording session.
final class RelayDiagnosticSpan {
  private let session: String
  private let correlation: Int
  private let started = ProcessInfo.processInfo.systemUptime
  private var ended = false
  private var bytes = 0

  init?(_ request: RelayedRequest, replayed: Bool) {
    guard let session = SupportDiagnosticEvents.session, SupportDiagnosticEvents.sink != nil else {
      return nil
    }
    let families: Set<String> = [
      "settings", "tasks", "runs", "providers", "models", "commands", "automations", "memory",
      "skills", "agents", "mcp", "apps", "addons", "resources", "artifacts", "status",
    ]
    let family = request.path.segments.dropFirst().first ?? ""
    let methods: Set<String> = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]
    let correlation = SupportDiagnosticEvents.record(
      "relay.begin",
      details: [
        "family": .string(families.contains(family) ? family : "other"),
        "method": .string(methods.contains(request.method) ? request.method : "other"),
        "replayed": .bool(replayed),
        "requestBytes": .number(Double(request.body?.count ?? 0)),
      ])
    guard correlation != 0, SupportDiagnosticEvents.session == session else { return nil }
    self.session = session
    self.correlation = correlation
  }

  func response(_ status: Int) {
    guard !ended, isRecording else { return }
    SupportDiagnosticEvents.record(
      "relay.response",
      details: [
        "status": .number(Double(status)), "elapsedMs": .number(elapsed),
      ], correlation: correlation)
  }

  func received(_ count: Int) {
    guard !ended, isRecording else { return }
    bytes += count
  }

  func finish(_ outcome: String, error: (any Error)? = nil) {
    guard !ended else { return }
    ended = true
    guard isRecording else { return }
    SupportDiagnosticEvents.record(
      "relay.end",
      details: [
        "outcome": .string(outcome), "elapsedMs": .number(elapsed),
        "responseBytes": .number(Double(bytes)),
        "errorCode": error.map { .number(Double(($0 as NSError).code)) } ?? .null,
      ], correlation: correlation)
  }

  private var isRecording: Bool {
    SupportDiagnosticEvents.session == session && SupportDiagnosticEvents.sink != nil
  }

  private var elapsed: Double { (ProcessInfo.processInfo.systemUptime - started) * 1000 }
}
