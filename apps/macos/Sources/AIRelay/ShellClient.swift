import AICore
import Foundation

/// Authenticated calls the shell makes for itself with the main token, including the
/// `shell`-exposure routes the relay never lets the page reach.
public struct ShellClient: Sendable {
  public let endpoint: ServiceEndpoint
  private let session: URLSession

  public init(endpoint: ServiceEndpoint) {
    self.endpoint = endpoint
    self.session = RelaySession.shared
  }

  /// `GET /v1/status` (`StatusResponseSchema`).
  public func status() async throws -> ServiceStatus {
    try JSONDecoder().decode(ServiceStatus.self, from: try await send("GET", "/v1/status").data)
  }

  /// `GET /v1/admin/routes`, the relay's allow-list source (decision R1).
  public func routeManifest() async throws -> RouteManifest {
    try RouteManifest.decode(try await send("GET", RelayPolicy.manifestPath).data)
  }

  /// `POST /v1/resources/import { paths }`: the service reads each file under its attachable
  /// rules and stores it as a resource. Each path succeeds or fails on its own.
  public func importResources(paths: [String]) async throws -> ResourceImportResponse {
    guard (1...10).contains(paths.count), paths.allSatisfy({ $0.hasPrefix("/") }) else {
      throw ShellClientError.invalidArgument("Import takes 1 to 10 absolute paths.")
    }
    let body = try JSONEncoder().encode(["paths": paths])
    let response = try await send(
      "POST", "/v1/resources/import", body: body, contentType: "application/json")
    return try JSONDecoder().decode(ResourceImportResponse.self, from: response.data)
  }

  /// `GET /v1/resources/:id`: a stored resource's bytes, with the name its
  /// `Content-Disposition` carries and its type.
  public func resource(id: String) async throws -> ServiceResource {
    guard !id.isEmpty else { throw ShellClientError.invalidArgument("The resource id is empty.") }
    let response = try await send("GET", "/v1/resources/\(RelayPath.encodeSegment(id))")
    return ServiceResource(
      bytes: response.data,
      name: ArtifactFileName.fromDisposition(response.headers["Content-Disposition"]),
      mime: response.headers["Content-Type"] ?? RendererMIMEType.fallback)
  }

  /// Downloads a resource the agent produced into `directory` as `<id>-<name>` and returns
  /// where it went (`handleArtifact` in `electron/agent/artifacts.ts`). Opening, revealing and
  /// copying the path are the caller's.
  public func downloadArtifact(
    id: String, into directory: URL
  ) async throws -> DownloadedArtifact {
    let resource = try await resource(id: id)
    let file = directory.appending(
      path: ArtifactFileName.downloadName(artifactId: id, name: resource.name),
      directoryHint: .notDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try resource.bytes.write(to: file, options: .atomic)
    return DownloadedArtifact(
      fileURL: file, name: resource.name, mime: resource.mime, size: resource.bytes.count)
  }

  /// `POST /v1/admin/shutdown`: the service answers, then drains and exits. Bounded, since quit
  /// waits on it and falls back to SIGTERM.
  public func shutdown() async throws {
    _ = try await send("POST", "/v1/admin/shutdown", timeout: 5)
  }

  private struct Response {
    let data: Data
    let headers: [String: String]
  }

  private func send(
    _ method: String, _ path: String, body: Data? = nil, contentType: String? = nil,
    timeout: TimeInterval? = nil
  ) async throws -> Response {
    guard let url = endpoint.url(encodedPath: path) else {
      throw ShellClientError.invalidArgument("The path cannot form a URL.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
    if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    request.httpBody = body
    if let timeout { request.timeoutInterval = timeout }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw ShellClientError.invalidResponse }
    guard (200..<300).contains(http.statusCode) else {
      let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
      throw ShellClientError.http(
        status: http.statusCode, code: envelope?.error.code, message: envelope?.error.message)
    }
    return Response(data: data, headers: http.stringHeaders)
  }

  private struct ErrorEnvelope: Decodable {
    struct Failure: Decodable {
      let code: String
      let message: String
    }
    let error: Failure
  }
}

public enum ShellClientError: LocalizedError, Equatable, Sendable {
  /// The service answered with an error status and, usually, its error envelope.
  case http(status: Int, code: String?, message: String?)
  case invalidResponse
  case invalidArgument(String)

  /// The service's own message where it gave one; it reaches the page or the agent as is.
  public var errorDescription: String? {
    switch self {
    case .http(let status, _, let message): message ?? "The agent service answered \(status)."
    case .invalidResponse: "The agent service sent an invalid response."
    case .invalidArgument(let message): message
    }
  }
}

/// The fields of `StatusResponseSchema` the shell uses.
public struct ServiceStatus: Decodable, Equatable, Sendable {
  public struct Service: Decodable, Equatable, Sendable {
    public let serviceId: String
    public let epoch: Int
  }
  public let service: Service
  public let draining: Bool
  /// Started and queued runs; the quit guard asks before stopping them.
  public let activeRuns: Int
  public let pendingConfirms: Int
  public let pendingCapabilities: Int
}

/// A stored resource's content.
public struct ServiceResource: Equatable, Sendable {
  public let bytes: Data
  public let name: String
  public let mime: String
}

public struct DownloadedArtifact: Equatable, Sendable {
  public let fileURL: URL
  public let name: String
  public let mime: String
  public let size: Int
}

extension ServiceLink {
  /// The quit guard's count of active runs (`activeRunCount` in `electron/quit-guard.ts`): an
  /// unavailable, failing or slower-than-`timeout` service counts as idle.
  public func activeRunsForQuitGuard(timeout: Duration = .milliseconds(1500)) async -> Int {
    guard case .success(let endpoint) = await endpoint() else { return 0 }
    let client = ShellClient(endpoint: endpoint)
    return await withTaskGroup(of: Int?.self) { group in
      group.addTask { (try? await client.status())?.activeRuns ?? 0 }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first ?? 0
    }
  }
}
