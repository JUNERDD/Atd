import AICore
import Foundation

/// Only validated method names and the call's lifecycle; parameters and results stay private.
final class BridgeDiagnosticSpan {
  private let correlation: Int
  private let session: String
  private let started = ProcessInfo.processInfo.systemUptime

  init?(call: NativeCall, id: Int, host: WebViewHost) {
    guard SupportDiagnostics.shared.recording, !call.name.hasPrefix("diagnostics.") else {
      return nil
    }
    session = SupportDiagnostics.shared.session
    correlation = SupportDiagnostics.shared.record(
      "bridge.begin", module: "bridge",
      details: [
        "method": .string(call.name), "callId": .number(Double(id)),
        "role": .string(host.role.rawValue), "document": .number(Double(host.document)),
      ])
  }

  func finish(_ reply: SwiftMessage) {
    guard SupportDiagnostics.shared.recording, SupportDiagnostics.shared.session == session else {
      return
    }
    let failed: Bool
    if case .error = reply { failed = true } else { failed = false }
    SupportDiagnostics.shared.record(
      "bridge.end", module: "bridge",
      details: [
        "failed": .bool(failed),
        "elapsedMs": .number((ProcessInfo.processInfo.systemUptime - started) * 1000),
      ], correlation: correlation)
  }
}
