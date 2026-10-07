import Foundation

/// Header allow-lists for the `/v1` relay. The upstream request is built from scratch: only
/// the listed page headers are copied, and the credential and epoch are added by Swift. The
/// page never sees or supplies `Authorization`, `Cookie` or `Set-Cookie`.
public enum RelayHeaders {
  /// Page headers copied upstream.
  /// - `Content-Type`: bodies are JSON or uploaded bytes; the service parses by it.
  /// - `Accept`: content negotiation for downloads.
  /// - `Range`: WebKit media elements (audio, video, PDF) request ranges of resources.
  ///
  /// Left out on purpose: `Content-Length` and other framing headers (URLSession frames the
  /// body it is given), `Authorization`/`Cookie` (the page holds no credential),
  /// `Accept-Language` and conditional headers (the service reads neither; language comes
  /// from settings), `Origin`/`Referer` (meaningless for a same-origin custom scheme).
  public static let request = ["Content-Type", "Accept", "Range"]

  /// Service headers copied back to the page.
  /// - `Content-Type`, `Content-Disposition`: resource downloads read the stored mime and name.
  /// - `Content-Length`: only when the body is passed through unchanged (see
  ///   ``forwardResponse(_:)``).
  /// - `Content-Range`, `Accept-Ranges`: answers to `Range`.
  /// - `Cache-Control`: the service's own caching intent, if it states one.
  /// - `Retry-After`: lets the client back off on 429/503.
  ///
  /// Left out on purpose: `Set-Cookie`, `Location` (the relay does not follow or expose
  /// redirects), `x-service-id`/`x-protocol-version` (service identity is the shell's
  /// concern), `ETag`/`Last-Modified` (their conditional request headers are not forwarded).
  public static let response = [
    "Content-Type", "Content-Length", "Content-Disposition", "Content-Range", "Accept-Ranges",
    "Cache-Control", "Retry-After",
  ]

  /// Added to every relayed response. The relay answers API data, never documents: if a
  /// response were ever navigated to or framed, it renders sandboxed with nothing allowed, and
  /// WebKit neither sniffs it into HTML nor caches it unless the service asked for caching.
  public static let responseDefaults = [
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  ]
  public static let defaultCacheControl = "no-store"

  /// The upstream request headers: allow-listed page headers plus the main-token
  /// `Authorization` and the manifest epoch precondition.
  public static func forwardRequest(_ page: [String: String], token: String, epoch: Int)
    -> [String: String]
  {
    var headers = copy(page, allowed: request)
    headers["Authorization"] = "Bearer \(token)"
    headers[RelayPolicy.epochHeader] = String(epoch)
    return headers
  }

  /// Page headers a user app's requests carry upstream: the body's type and, through `Accept`,
  /// whether the service answers an API call as one JSON value or as an NDJSON stream. No
  /// `Range`: user apps reach only API routes through the shell, never stored files.
  public static let userAppRequest = ["Content-Type", "Accept"]

  /// The upstream headers of a user app's `/api` request, sent to a `shell`-exposure route: the
  /// allow-listed page headers plus the main-token `Authorization`. No manifest epoch: those
  /// routes are the shell's own calls, which never pass the relay's manifest.
  public static func forwardUserAppRequest(_ page: [String: String], token: String)
    -> [String: String]
  {
    var headers = copy(page, allowed: userAppRequest)
    headers["Authorization"] = "Bearer \(token)"
    return headers
  }

  /// The headers answered to the page. URLSession decodes `Content-Encoding` transparently,
  /// so a declared length would describe the encoded bytes; it is kept only for identity
  /// bodies.
  public static func forwardResponse(_ upstream: [String: String]) -> [String: String] {
    var headers = copy(upstream, allowed: response)
    let encoding = value(of: "Content-Encoding", in: upstream)?.trimmingCharacters(in: .whitespaces)
    if let encoding, !encoding.isEmpty, encoding.lowercased() != "identity" {
      headers["Content-Length"] = nil
    }
    if headers["Cache-Control"] == nil { headers["Cache-Control"] = defaultCacheControl }
    headers.merge(responseDefaults) { _, injected in injected }
    return headers
  }

  /// Case-insensitive copy that answers the canonical spelling of each allowed name.
  private static func copy(_ source: [String: String], allowed: [String]) -> [String: String] {
    var copied: [String: String] = [:]
    for name in allowed {
      if let value = value(of: name, in: source) { copied[name] = value }
    }
    return copied
  }

  private static func value(of name: String, in headers: [String: String]) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }
}
