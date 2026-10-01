import Foundation

/// Request-level checks of the `ai-app://renderer` handler that come before any routing
/// (decision R7). WebKit sends no CORS preflight for a custom scheme, so a page of another origin
/// can reach the handler with a body (spike S2); these checks are what keeps such requests out.
public enum RelayRequestGate {
  /// The serialized origin of the renderer page, as WebKit sends it in `Origin`.
  public static let rendererOrigin = "ai-app://renderer"
  /// Marks a state-changing `/v1` request as the renderer's own call. A cross-origin form post or
  /// no-cors fetch cannot add a custom header, so requiring it closes that path even if an
  /// `Origin` were ever missing.
  public static let relayMarkerHeader = "x-ai-relay"
  public static let relayMarkerValue = "1"

  public enum Refusal: Equatable, Sendable {
    /// `Origin` is present and is not the renderer's, or another document made the request.
    case foreignOrigin
    /// A `/v1` request other than GET or HEAD without `x-ai-relay: 1`.
    case missingRelayMarker
    /// A method other than GET or HEAD for a renderer file.
    case methodNotAllowed
  }

  /// Applies to every request. A navigation of the main document carries no `Origin`; every
  /// subresource request and fetch of the renderer carries exactly ``rendererOrigin``. `null`
  /// (sandboxed or opaque origins) is present and refused.
  public static func checkOrigin(headers: [String: String]) -> Refusal? {
    guard let origin = value(of: "Origin", in: headers) else { return nil }
    return origin == rendererOrigin ? nil : .foreignOrigin
  }

  /// Applies to every request, next to ``checkOrigin(headers:)``. WebKit omits `Origin` on a
  /// cross-origin `no-cors` request to a custom scheme (GET and POST alike, observed on macOS 26),
  /// so `Origin` alone lets another page's GETs through, opaque but executed. The request's main
  /// document is set by WebKit, not the page, and names the page that asked; the renderer's own
  /// requests always come from an `ai-app://renderer` document. Nil (no document) passes.
  public static func checkDocument(_ mainDocumentURL: URL?) -> Refusal? {
    guard let mainDocumentURL else { return nil }
    let isRenderer =
      mainDocumentURL.scheme == RelayPath.scheme
      && mainDocumentURL.host(percentEncoded: true) == RelayPath.host
      && mainDocumentURL.port == nil && mainDocumentURL.user == nil
    return isRenderer ? nil : .foreignOrigin
  }

  /// Applies to `/v1` requests after ``checkOrigin(headers:)``.
  public static func checkAPI(method: String, headers: [String: String]) -> Refusal? {
    if isSafe(method) { return nil }
    let marker = value(of: relayMarkerHeader, in: headers)?.trimmingCharacters(in: .whitespaces)
    return marker == relayMarkerValue ? nil : .missingRelayMarker
  }

  /// Applies to renderer files: bundled assets and, in development, the Vite dev server.
  public static func checkAsset(method: String) -> Refusal? {
    isSafe(method) ? nil : .methodNotAllowed
  }

  /// GET and HEAD, the only methods that never change service state. Compared exactly: WebKit
  /// upper-cases the standard methods, and a lower-case `get` is some other method.
  public static func isSafe(_ method: String) -> Bool {
    method == "GET" || method == "HEAD"
  }

  private static func value(of name: String, in headers: [String: String]) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }
}
