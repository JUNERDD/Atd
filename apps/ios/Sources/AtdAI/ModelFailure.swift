import Foundation

/// Why a model request did not produce a complete answer, in the terms the person can act on.
/// Cancellation is not a failure: a cancelled request ends with `CancellationError`.
public enum ModelFailure: Error, Sendable, Equatable {
  /// No connection is configured, or the one a command names was removed with no default left.
  case noModel
  /// No network, the provider's host unreachable, or the connection dropped.
  case offline
  /// No response within the connect deadline, or a pause between chunks longer than allowed.
  case timedOut
  /// 401 or 403, or no key stored for the connection.
  case invalidKey
  /// 429, or the account is out of credit (402).
  case rateLimited(retryAfter: Duration?)
  /// 5xx, an error event mid-stream, or a stream that ended before the answer did.
  case server(status: Int?)
  /// The provider declined the content or filtered the answer.
  case refused
  /// 404: the model or the address does not exist.
  case notFound
  /// Another 4xx: the provider did not accept the request; `detail` is its own message.
  case rejected(detail: String?)
  /// The answer reached the output ceiling before it finished.
  case truncated
  /// The response is not the protocol's (a web page, an unknown shape).
  case unreadable(detail: String?)

  /// One short line for the keyboard strip or under a result.
  public var message: String {
    switch self {
    case .noModel: String(localized: "failure.noModel", bundle: .module)
    case .offline, .timedOut: String(localized: "failure.offline", bundle: .module)
    case .invalidKey: String(localized: "failure.invalidKey", bundle: .module)
    case .rateLimited(let wait?):
      String(localized: "failure.rateLimited.wait \(Self.seconds(wait))", bundle: .module)
    case .rateLimited(nil): String(localized: "failure.rateLimited", bundle: .module)
    case .server: String(localized: "failure.server", bundle: .module)
    case .refused: String(localized: "failure.refused", bundle: .module)
    case .notFound: String(localized: "failure.notFound", bundle: .module)
    case .rejected: String(localized: "failure.rejected", bundle: .module)
    case .truncated: String(localized: "failure.truncated", bundle: .module)
    case .unreadable: String(localized: "failure.unreadable", bundle: .module)
    }
  }

  /// Whole seconds to wait, at least one.
  private static func seconds(_ wait: Duration) -> Int {
    Int(max(wait.components.seconds, 1))
  }

  /// Whether sending the same request again can succeed without changing anything.
  public var canRetry: Bool {
    switch self {
    case .offline, .timedOut, .rateLimited, .server, .unreadable: true
    case .noModel, .invalidKey, .refused, .notFound, .rejected, .truncated: false
    }
  }

  /// The failure an HTTP status stands for; protocol clients refine it from the error body.
  static func status(_ status: Int, retryAfter: Duration? = nil, detail: String? = nil)
    -> ModelFailure
  {
    switch status {
    case 401, 403: .invalidKey
    case 402: .rateLimited(retryAfter: nil)
    case 404: .notFound
    case 408: .timedOut
    case 429: .rateLimited(retryAfter: retryAfter)
    case 400..<500: .rejected(detail: detail)
    default: .server(status: status)
    }
  }

  /// Maps what a request threw to a failure, keeping cancellation as it is.
  static func from(_ error: any Error) -> any Error {
    switch error {
    case let failure as ModelFailure: return failure
    case is CancellationError: return error
    case let error as URLError: return from(error)
    default: return ModelFailure.unreadable(detail: String(describing: error))
    }
  }

  private static func from(_ error: URLError) -> any Error {
    switch error.code {
    case .cancelled: CancellationError()
    case .timedOut: ModelFailure.timedOut
    case .badURL, .unsupportedURL, .badServerResponse, .cannotParseResponse,
      .cannotDecodeContentData, .cannotDecodeRawData, .dataLengthExceedsMaximum:
      ModelFailure.unreadable(detail: error.localizedDescription)
    case .appTransportSecurityRequiresSecureConnection:
      ModelFailure.rejected(detail: error.localizedDescription)
    // Everything else is the network between the phone and the provider: no route, DNS, TLS
    // (often a captive portal), a dropped connection.
    default: ModelFailure.offline
    }
  }
}
