import Foundation

/// A running agent service as its data directory describes it: `endpoint.json` (written by the
/// service once it listens) and the main token in `auth/token` (0600). The token only ever lives
/// in that file; the
/// keychain namespace `ai-agent-service:<serviceId>` holds provider, MCP and plugin secrets that
/// the shell never reads.
public struct ServiceEndpoint: Equatable, Sendable {
  public let dataDirectory: URL
  /// `http://127.0.0.1:<port>`, no trailing slash.
  public let baseURL: URL
  public let token: String
  public let serviceId: String
  /// Boot counter; a restart always changes it.
  public let epoch: Int
  public let pid: Int32
  /// ISO time the process started.
  public let startedAt: String
  /// Build of a packaged service (`build-info.json`); nil for development services.
  public let buildId: String?

  /// The stream endpoint on the same port.
  public var streamURL: URL {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    components.scheme = "ws"
    components.path = "/v1/stream"
    return components.url!
  }

  /// Same process and listener. Two reads of an unchanged `endpoint.json` compare equal here even
  /// if the token file was rewritten, which never happens while a service runs.
  public func isSameInstance(as other: ServiceEndpoint) -> Bool {
    serviceId == other.serviceId && epoch == other.epoch && pid == other.pid
      && baseURL == other.baseURL
  }
}

public enum ServiceEndpointError: Error, Equatable, Sendable {
  /// `endpoint.json` is missing: no service is running for this data directory.
  case notRunning
  /// A file does not match its schema (unknown keys included, as the TypeBox schemas refuse
  /// additional properties).
  case malformed(String)
  case notLoopback
  case unsupportedProtocol
  case tokenMismatch
  /// The recorded process is gone; the file outlived a crash.
  case stale
}

public enum ServiceEndpointFiles {
  public static let endpointPath = "endpoint.json"
  public static let tokenPath = "auth/token"
  public static let supportedProtocolVersion = "1"

  /// Validates both files and pairs them. The liveness of `pid` is the caller's check.
  public static func parse(
    endpoint endpointData: Data, token tokenData: Data, dataDirectory: URL
  ) throws(ServiceEndpointError) -> ServiceEndpoint {
    let endpoint: EndpointFile = try decode(endpointData, keys: EndpointFile.keys, "endpoint.json")
    guard endpoint.version == 1, (1...128).contains(endpoint.serviceId.count),
      endpoint.protocolVersion.count <= 16, endpoint.epoch >= 0, endpoint.host.count <= 256,
      (1...65535).contains(endpoint.port), endpoint.url.count <= 2048, endpoint.pid >= 1,
      endpoint.pid <= Int(Int32.max), endpoint.buildId.map({ (1...128).contains($0.count) }) ?? true
    else { throw .malformed("endpoint.json") }
    guard let baseURL = loopbackBaseURL(endpoint.url) else { throw .notLoopback }
    guard endpoint.protocolVersion == supportedProtocolVersion else { throw .unsupportedProtocol }
    let token: TokenFile = try decode(tokenData, keys: TokenFile.keys, "auth/token")
    guard token.version == 1, (1...128).contains(token.serviceId.count),
      (32...256).contains(token.token.count)
    else { throw .malformed("auth/token") }
    guard token.serviceId == endpoint.serviceId else { throw .tokenMismatch }
    return ServiceEndpoint(
      dataDirectory: dataDirectory, baseURL: baseURL, token: token.token,
      serviceId: endpoint.serviceId, epoch: endpoint.epoch, pid: Int32(endpoint.pid),
      startedAt: endpoint.startedAt, buildId: endpoint.buildId)
  }

  /// `http://` on a loopback host with a port, and no path, query or credentials. Stricter than a
  /// prefix check, which would also take `http://127.0.0.1.example.com`.
  static func loopbackBaseURL(_ raw: String) -> URL? {
    guard let url = URL(string: raw), url.scheme == "http",
      let host = url.host(percentEncoded: false), ["127.0.0.1", "localhost", "::1"].contains(host),
      let port = url.port, (1...65535).contains(port), url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, ["", "/"].contains(url.path(percentEncoded: true))
    else { return nil }
    let authority = host.contains(":") ? "[\(host)]" : host
    return URL(string: "http://\(authority):\(port)")
  }

  private static func decode<T: Decodable>(
    _ data: Data, keys: Set<String>, _ name: String
  ) throws(ServiceEndpointError) -> T {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(object.keys).isSubset(of: keys), let value = try? JSONDecoder().decode(T.self, from: data)
    else { throw .malformed(name) }
    return value
  }

  private struct EndpointFile: Decodable {
    static let keys: Set<String> = [
      "version", "serviceId", "protocolVersion", "epoch", "host", "port", "url", "pid", "startedAt",
      "buildId",
    ]
    let version: Int
    let serviceId: String
    let protocolVersion: String
    let epoch: Int
    let host: String
    let port: Int
    let url: String
    let pid: Int
    let startedAt: String
    let buildId: String?
  }

  private struct TokenFile: Decodable {
    static let keys: Set<String> = ["version", "serviceId", "token", "createdAt"]
    let version: Int
    let serviceId: String
    let token: String
    let createdAt: String
  }
}

/// Where the shell finds the service's data directory.
public enum ServiceDataDirectory {
  /// Overrides the directory in both configurations (isolated debugging, `open --env` tests of a
  /// packaged build). Read exactly as the service reads it: trimmed, empty ignored.
  public static let overrideVariable = "AI_AGENT_DATA_DIR"
  /// The packaged app's directory.
  public static let productionFolder = "AgentService"
  /// The directory `pnpm dev` serves and a Debug shell connects to (spike S10).
  public static let developmentFolder = "AgentService Dev"

  public static func resolve(environment: [String: String], home: URL, development: Bool) -> URL {
    if let raw = environment[overrideVariable]?.trimmingCharacters(in: .whitespacesAndNewlines),
      !raw.isEmpty
    {
      return URL(fileURLWithPath: raw, isDirectory: true).standardizedFileURL
    }
    let folder = development ? developmentFolder : productionFolder
    return home.appending(
      path: "Library/Application Support/\(folder)", directoryHint: .isDirectory)
  }
}
