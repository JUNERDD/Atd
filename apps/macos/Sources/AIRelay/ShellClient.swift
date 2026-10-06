import AICore
import AIWidgetModel
import Foundation

/// Authenticated calls the shell makes for itself with the main token, including the
/// `shell`-exposure routes the relay never lets the page reach. Nonisolated: a value any task
/// may hold (the quit guard races it against a timeout); its calls run on the caller's executor.
public nonisolated struct ShellClient: Sendable {
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

  /// `POST /v1/folders/register { paths }`: the service checks each directory and answers a
  /// folder ref a task can be granted; each path succeeds or fails on its own.
  public func registerFolders(paths: [String]) async throws -> FolderRegisterResponse {
    guard (1...ImportBatch.maxFolders).contains(paths.count),
      paths.allSatisfy({ $0.hasPrefix("/") })
    else {
      throw ShellClientError.invalidArgument("Register takes 1 to 10 absolute paths.")
    }
    let body = try JSONEncoder().encode(["paths": paths])
    let response = try await send(
      "POST", "/v1/folders/register", body: body, contentType: "application/json")
    return try JSONDecoder().decode(FolderRegisterResponse.self, from: response.data)
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

  /// Downloads a resource the agent produced into `directory` as `<id>-<name>`, quarantined,
  /// and returns where it went. Opening, revealing and copying the path are the caller's. The
  /// file write runs off the main actor.
  @concurrent
  public func downloadArtifact(
    id: String, into directory: URL
  ) async throws -> DownloadedArtifact {
    let resource = try await resource(id: id)
    let file = directory.appending(
      path: ArtifactFileName.downloadName(artifactId: id, name: resource.name),
      directoryHint: .notDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try DownloadQuarantine.app.write(resource.bytes, to: file)
    return DownloadedArtifact(
      fileURL: file, name: resource.name, mime: resource.mime, size: resource.bytes.count)
  }

  /// `GET /v1/admin/approvals/mcp/:serverId`: what approving the server's launch would allow.
  /// A server that needs no approval answers 400.
  public func mcpLaunchApprovalDetails(serverId: String) async throws -> McpLaunchApprovalDetails {
    guard !serverId.isEmpty else {
      throw ShellClientError.invalidArgument("The server id is empty.")
    }
    let response = try await send(
      "GET", "/v1/admin/approvals/mcp/\(RelayPath.encodeSegment(serverId))")
    return try JSONDecoder().decode(McpLaunchApprovalDetails.self, from: response.data)
  }

  /// `POST /v1/admin/approvals/mcp`: approves the launch the request's fingerprint describes.
  /// A fingerprint the service no longer computes (409 `approval_changed`) is `changed`.
  public func approveMcpLaunch(_ request: McpLaunchApproveRequest) async throws
    -> McpLaunchApproveOutcome
  {
    let response: Response
    do {
      response = try await send(
        "POST", "/v1/admin/approvals/mcp", body: try JSONEncoder().encode(request),
        contentType: "application/json")
    } catch ShellClientError.http(let status, let code, let message) {
      guard let outcome = McpLaunchApproveOutcome.refusal(status: status, code: code) else {
        throw ShellClientError.http(status: status, code: code, message: message)
      }
      return outcome
    }
    _ = try JSONDecoder().decode(McpLaunchApproveResponse.self, from: response.data)
    return .approved
  }

  /// `GET /v1/apps/:appId/runtime`: the current version an app's window shows. A deleted app
  /// answers 404 (``ShellClientError/http(status:code:message:)``).
  public func appRuntime(appId: String) async throws -> UserAppRuntime {
    guard UserAppOrigin.isValidAppId(appId) else {
      throw ShellClientError.invalidArgument("Not an app id.")
    }
    let response = try await send("GET", "/v1/apps/\(appId)/runtime")
    return try UserAppRuntime.decode(response.data, appId: appId)
  }

  /// `POST /v1/apps/:appId/diagnostics { entries }`: errors an app's page reported.
  public func postAppDiagnostics(appId: String, entries: [UserAppDiagnostic]) async throws {
    guard UserAppOrigin.isValidAppId(appId), !entries.isEmpty else {
      throw ShellClientError.invalidArgument("Diagnostics need an app id and entries.")
    }
    _ = try await send(
      "POST", "/v1/apps/\(appId)/diagnostics",
      body: try JSONEncoder().encode(["entries": entries]), contentType: "application/json")
  }

  /// `GET /v1/widgets/snapshots`: the widget catalog and every snapshot, checked against the
  /// contract while decoding.
  public func widgetSync() async throws -> WidgetSync {
    try JSONDecoder().decode(
      WidgetSync.self, from: try await send("GET", "/v1/widgets/snapshots").data)
  }

  /// `POST /v1/widgets/instances`: the widgets the system shows, which the service renders.
  public func postWidgetInstances(_ instances: [WidgetInstance]) async throws {
    let body = try JSONEncoder().encode(WidgetInstancesRequest(instances: instances))
    _ = try await send("POST", "/v1/widgets/instances", body: body, contentType: "application/json")
  }

  /// `GET /v1/automation-notices`: the automation notices nobody acknowledged yet, oldest first,
  /// checked against the contract while decoding.
  public func automationNotices() async throws -> [AutomationNotice] {
    try JSONDecoder().decode(
      AutomationNoticesResponse.self, from: try await send("GET", "/v1/automation-notices").data
    ).notices
  }

  /// `POST /v1/automation-notices/ack { ids }`: notices the shell is done with, shown or not. The
  /// service ignores ids it no longer has.
  public func acknowledgeAutomationNotices(ids: [String]) async throws {
    guard (1...AutomationNotice.maxPending).contains(ids.count) else {
      throw ShellClientError.invalidArgument("Acknowledge takes 1 to 50 notice ids.")
    }
    let body = try JSONEncoder().encode(["ids": ids])
    _ = try await send(
      "POST", "/v1/automation-notices/ack", body: body, contentType: "application/json")
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

public nonisolated enum ShellClientError: LocalizedError, Equatable, Sendable {
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
public nonisolated struct ServiceStatus: Decodable, Equatable, Sendable {
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
public nonisolated struct ServiceResource: Equatable, Sendable {
  public let bytes: Data
  public let name: String
  public let mime: String
}

public nonisolated struct DownloadedArtifact: Equatable, Sendable {
  public let fileURL: URL
  public let name: String
  public let mime: String
  public let size: Int
}

extension McpApprovalGate.Service {
  /// The gate's routes through the shell's own client.
  public init(client: ShellClient) {
    self.init(
      details: { try await client.mcpLaunchApprovalDetails(serverId: $0) },
      approve: { try await client.approveMcpLaunch($0) })
  }
}

extension AutomationNoticeFeed.Service {
  /// The feed's routes through the shell's own client.
  public init(client: ShellClient) {
    self.init(
      pending: { try await client.automationNotices() },
      acknowledge: { try await client.acknowledgeAutomationNotices(ids: $0) })
  }
}

extension ServiceLink {
  /// The quit guard's count of active runs: an unavailable, failing or slower-than-`timeout`
  /// service counts as idle.
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
