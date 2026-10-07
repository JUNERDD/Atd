import Foundation

/// Where a user app's request goes once it passed ``UserAppRequestGate``.
public enum UserAppTarget: Equatable, Sendable {
  /// A file of the app's current version (`web/`), GET or HEAD.
  case asset(NormalizedPath)
  /// `POST /api/<name>`: the backend's API function, forwarded to
  /// `POST /v1/apps/:appId/api/:name`.
  case call(name: String, query: String?)
  /// `GET /api/events`: the backend's event stream, forwarded to `GET /v1/apps/:appId/events`.
  case events(query: String?)
}

/// The request checks of the `ai-userapp://<appId>` handler, all made before any file is read or
/// anything reaches the service. `appId` is the app of the window whose web view made the
/// request (the shell's registry), never anything the page says.
///
/// WebKit sends no CORS preflight for a custom scheme and, for same-origin requests, no `Origin`
/// at all (T1), so `Origin` alone proves nothing. What does: the request's main document, which
/// WebKit sets and the page cannot, must be this app's page; the URL's host must be this app; and
/// a state-changing call must carry `x-ai-relay: 1`, which a form post or `no-cors` request
/// cannot add.
public enum UserAppRequestGate {
  /// Request bodies arrive whole in memory (`httpBody`); larger ones are refused, matching the
  /// service's limit for a backend call.
  public static let maxBodyBytes = 4 * 1024 * 1024
  public static let apiSegment = "api"
  public static let eventsName = "events"

  /// A request as the scheme handler received it.
  public struct Request: Sendable {
    public var method: String
    public var url: URL
    public var headers: [String: String]
    public var mainDocumentURL: URL?
    public var body: Data?
    public var hasBodyStream: Bool

    public init(
      method: String, url: URL, headers: [String: String], mainDocumentURL: URL?, body: Data?,
      hasBodyStream: Bool
    ) {
      self.method = method
      self.url = url
      self.headers = headers
      self.mainDocumentURL = mainDocumentURL
      self.body = body
      self.hasBodyStream = hasBodyStream
    }
  }

  public enum Refusal: Error, Equatable, Sendable {
    /// `Origin` names another origin, the main document is not this app's page, or the URL's
    /// host is not this app.
    case foreignOrigin
    /// The path or query failed ``RelayPath`` normalization.
    case invalidURL(RelayRequestError)
    /// `/api` itself, or a path below `/api` that is neither a call nor the event stream.
    case notFound
    /// Files take GET and HEAD, calls POST, the event stream GET.
    case methodNotAllowed
    /// A call without `x-ai-relay: 1`.
    case missingRelayMarker
    /// A streamed body (`ReadableStream`), which WebKit cannot deliver to a scheme handler.
    case bodyStream
    /// A multipart or octet-stream call whose body arrived empty: WebKit drops `Blob`, `File`
    /// and file `FormData` bodies (T1), so forwarding it would hand the backend nothing.
    case missingBody
    /// More than ``maxBodyBytes``.
    case tooLarge

    public var status: Int {
      switch self {
      case .foreignOrigin, .invalidURL, .missingRelayMarker: 403
      case .notFound: 404
      case .methodNotAllowed: 405
      case .bodyStream, .missingBody: 400
      case .tooLarge: 413
      }
    }

    /// For the app's developer, in the service's error envelope; English like the service's own
    /// validation messages.
    public var message: String {
      switch self {
      case .foreignOrigin: "Requests from other origins are refused."
      case .invalidURL: "The request URL is not allowed."
      case .notFound: "No such API route. Call POST /api/<name> or GET /api/events."
      case .methodNotAllowed: "This method is not allowed for this path."
      case .missingRelayMarker: "API calls need the x-ai-relay: 1 header."
      case .bodyStream: "Send request bodies as bytes or text, not streams."
      case .missingBody: "The body arrived empty. Send ArrayBuffer or Uint8Array, not Blob or File."
      case .tooLarge: "The request body is larger than 4 MiB."
      }
    }
  }

  public static func check(_ request: Request, appId: String) -> Result<UserAppTarget, Refusal> {
    if let origin = value(of: "Origin", in: request.headers),
      origin != UserAppOrigin.serialized(appId: appId)
    {
      return .failure(.foreignOrigin)
    }
    guard UserAppOrigin.isOwn(request.mainDocumentURL, appId: appId) else {
      return .failure(.foreignOrigin)
    }
    let path: NormalizedPath
    do throws(RelayRequestError) {
      path = try RelayPath.normalizedPath(
        of: request.url, scheme: UserAppOrigin.scheme, host: appId)
    } catch .wrongOrigin {
      return .failure(.foreignOrigin)
    } catch {
      return .failure(.invalidURL(error))
    }
    guard path.segments.first == apiSegment else {
      guard RelayRequestGate.isSafe(request.method) else { return .failure(.methodNotAllowed) }
      return .success(.asset(path))
    }
    guard path.segments.count == 2 else { return .failure(.notFound) }
    let query: String?
    do throws(RelayRequestError) {
      query = try RelayPath.query(of: request.url)
    } catch {
      return .failure(.invalidURL(error))
    }
    let name = path.segments[1]
    if request.method == "GET" {
      return name == eventsName ? .success(.events(query: query)) : .failure(.methodNotAllowed)
    }
    guard request.method == "POST" else { return .failure(.methodNotAllowed) }
    if let refusal = checkCall(request) { return .failure(refusal) }
    return .success(.call(name: name, query: query))
  }

  /// The checks of a state-changing call, after routing.
  private static func checkCall(_ request: Request) -> Refusal? {
    let marker = value(of: RelayRequestGate.relayMarkerHeader, in: request.headers)?
      .trimmingCharacters(in: .whitespaces)
    guard marker == RelayRequestGate.relayMarkerValue else { return .missingRelayMarker }
    guard !request.hasBodyStream else { return .bodyStream }
    let size = request.body?.count ?? 0
    guard size <= maxBodyBytes else { return .tooLarge }
    if size == 0, expectsBytes(value(of: "Content-Type", in: request.headers)) {
      return .missingBody
    }
    return nil
  }

  /// The content types WebKit leaves empty when the page sends a `Blob`, `File` or `FormData`.
  private static func expectsBytes(_ contentType: String?) -> Bool {
    guard let contentType else { return false }
    let essence = (contentType.split(separator: ";", maxSplits: 1).first ?? "")
      .trimmingCharacters(in: .whitespaces).lowercased()
    return essence.hasPrefix("multipart/") || essence == "application/octet-stream"
  }

  private static func value(of name: String, in headers: [String: String]) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }
}
