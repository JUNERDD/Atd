import Foundation

/// Answers the relay produces itself, in the service's error envelope
/// (`{ "error": { "code", "message" } }`, `ErrorEnvelopeSchema`), so the page's HTTP client
/// reports them like any service error.
public enum RelayErrorBody {
  public static let contentType = "application/json; charset=utf-8"

  /// The envelope code for a relay status. The contract has no "unavailable" code, so 502 and
  /// 503 use `internal`; the status and message still tell them apart.
  public static func code(for status: Int) -> String {
    switch status {
    case 400, 405: "bad_request"
    case 403: "forbidden"
    case 404: "not_found"
    case 413: "payload_too_large"
    default: "internal"
    }
  }

  public static func json(status: Int, message: String) -> Data {
    let envelope = Envelope(error: .init(code: code(for: status), message: message))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    // Two strings always encode.
    return try! encoder.encode(envelope)
  }

  private struct Envelope: Encodable {
    struct Failure: Encodable {
      let code: String
      let message: String
    }
    let error: Failure
  }
}
