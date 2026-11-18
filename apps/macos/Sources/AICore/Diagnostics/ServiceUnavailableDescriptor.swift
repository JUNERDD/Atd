import Foundation

/// Why no service endpoint is available (`ServiceLink`, `ServiceSupervisor`, `APIRelay`,
/// `VirtualSocketPipe`, and `WindowRecoveryView`).
public enum ServiceUnavailable: Error, Equatable, Sendable {
  /// Debug: nothing serves the development data directory. The shell never starts one; the
  /// developer runs `pnpm dev`.
  case developmentServiceNotRunning
  /// The data directory's files exist but are not a usable endpoint.
  case invalidEndpoint(ServiceEndpointError)
  /// Release: the supervisor is starting or restarting the service.
  case starting
  /// Release: the first start failed; the detail is what the service logged.
  case failed(String)
  /// Release: three unexpected exits within five minutes opened the circuit breaker; only a
  /// manual restart tries again.
  case stoppedTooOften
  /// Release: the supervisor was stopped (quit).
  case stopped
}

/// Maps every ``ServiceUnavailable`` and ``ServiceEndpointError`` case to its wire error code,
/// scrubbed user-facing summary (`<= 170` UTF-8 bytes), and virtual WebSocket close frame (`<= 200`
/// UTF-8 bytes) per `03-contracts-routes-and-ui.md` §2.2/§2.4.
public nonisolated struct ServiceUnavailableDescriptor: Equatable, Sendable {
  public static let maxInlineSummaryUTF8Bytes = 170
  public static let maxCloseReasonUTF8Bytes = 200

  public let errorCode: String
  public let summary: String
  public let wsCloseCode: UInt16
  public let wsCloseReason: String

  public init(errorCode: String, summary: String, wsCloseCode: UInt16) {
    self.errorCode = errorCode
    self.summary = summary
    self.wsCloseCode = wsCloseCode
    let combined = "\(errorCode): \(summary)"
    if combined.utf8.count <= Self.maxCloseReasonUTF8Bytes {
      self.wsCloseReason = combined
    } else {
      self.wsCloseReason = DiagnosticsScrubberRules.truncateUTF8(
        combined, maxPrefixBytes: Self.maxCloseReasonUTF8Bytes - 3, suffix: "…")
    }
  }

  /// Exhaustive machine-code mapping for ``ServiceEndpointError`` (`ServiceEndpoint.swift:38-49`).
  public static func endpointErrorCode(_ error: ServiceEndpointError) -> String {
    switch error {
    case .notRunning:
      "not_running"
    case .malformed(let file):
      file == ServiceEndpointFiles.tokenPath ? "malformed_token" : "malformed_endpoint"
    case .notLoopback:
      "not_loopback"
    case .unsupportedProtocol:
      "unsupported_protocol"
    case .tokenMismatch:
      "token_mismatch"
    case .stale:
      "stale_pid"
    }
  }

  /// Describes `reason`, scrubbing any startup failure text via ``DiagnosticsScrubber`` and
  /// preserving `lastFailure` when the supervisor circuit breaker enters `.stoppedTooOften`.
  public static func describe(
    _ reason: ServiceUnavailable,
    lastFailure: String? = nil,
    anchors: DiagnosticsScrubber.EnvironmentAnchors = .current
  ) -> Self {
    switch reason {
    case .starting:
      return Self(
        errorCode: "service_starting",
        summary: "The agent service is starting.",
        wsCloseCode: 1013)

    case .failed(let detail):
      let scrubbed = DiagnosticsScrubber.scrubInlineSummary(
        detail, maxUTF8Bytes: maxInlineSummaryUTF8Bytes, anchors: anchors)
      return Self(
        errorCode: "service_start_failed",
        summary: scrubbed.isEmpty ? "The agent service failed to start." : scrubbed,
        wsCloseCode: 1011)

    case .stoppedTooOften:
      let retained = lastFailure.map {
        DiagnosticsScrubber.scrubInlineSummary(
          $0, maxUTF8Bytes: maxInlineSummaryUTF8Bytes, anchors: anchors)
      }
      let summary =
        if let retained, !retained.isEmpty {
          retained
        } else {
          "The agent service stopped repeatedly and paused automatic restarts."
        }
      return Self(
        errorCode: "service_stopped_too_often",
        summary: summary,
        wsCloseCode: 1011)

    case .developmentServiceNotRunning:
      return Self(
        errorCode: "service_not_running",
        summary: "Development service is not running (run pnpm dev).",
        wsCloseCode: 1011)

    case .invalidEndpoint(let endpointError):
      return Self(
        errorCode: "service_not_running",
        summary: "Service endpoint unusable (\(endpointErrorCode(endpointError))).",
        wsCloseCode: 1011)

    case .stopped:
      return Self(
        errorCode: "service_not_running",
        summary: "The agent service is stopped.",
        wsCloseCode: 1001)
    }
  }
}
