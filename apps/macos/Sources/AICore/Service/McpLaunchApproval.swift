/// What approving an MCP server's launch would allow (`McpLaunchApprovalDetailsSchema` in
/// packages/agent-contracts/src/mcp-approvals.ts), as `GET /v1/admin/approvals/mcp/:serverId`
/// answers it. The service never sends a stdio env value or an HTTP header value: only keys,
/// lengths and the names of the service env vars a request would carry.
public struct McpLaunchApprovalDetails: Decodable, Equatable, Sendable {
  public enum Layer: String, Decodable, Equatable, Sendable {
    case user
    case plugin
  }

  public enum Kind: String, Decodable, Equatable, Sendable {
    case stdio = "mcp-stdio"
    case httpEnv = "mcp-http-env"
  }

  /// Never `notRequired` here: the service answers 400 for a server that needs no approval.
  public enum State: String, Decodable, Equatable, Sendable {
    case notRequired
    case required
    case changed
    case approved
  }

  /// The plugin that contributes a plugin server.
  public struct Plugin: Decodable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let version: String?
    /// `npm <name>@<version>`, `git <url>@<commit>` or `local <path>`.
    public let source: String
    public let revision: String

    public init(id: String, name: String, version: String?, source: String, revision: String) {
      self.id = id
      self.name = name
      self.version = version
      self.source = source
      self.revision = revision
    }
  }

  public struct EnvEntry: Decodable, Equatable, Sendable {
    public let key: String
    /// The value's length; the value itself never leaves the service.
    public let length: Int
    /// Changes what the runtime loads or where it looks (`NODE_OPTIONS`, `DYLD_*`, `PATH`, …).
    public let risky: Bool

    public init(key: String, length: Int, risky: Bool) {
      self.key = key
      self.length = length
      self.risky = risky
    }
  }

  public struct Stdio: Decodable, Equatable, Sendable {
    public let command: String
    /// The executable the command resolves to now; what actually runs.
    public let resolvedCommand: String
    public let args: [String]
    public let cwd: String
    /// Whether the process inherits the service environment beyond `env`.
    public let inheritEnv: Bool
    public let env: [EnvEntry]

    public init(
      command: String, resolvedCommand: String, args: [String], cwd: String, inheritEnv: Bool,
      env: [EnvEntry]
    ) {
      self.command = command
      self.resolvedCommand = resolvedCommand
      self.args = args
      self.cwd = cwd
      self.inheritEnv = inheritEnv
      self.env = env
    }
  }

  public struct Header: Decodable, Equatable, Sendable {
    public let key: String
    public let readsEnv: Bool

    public init(key: String, readsEnv: Bool) {
      self.key = key
      self.readsEnv = readsEnv
    }
  }

  public struct Http: Decodable, Equatable, Sendable {
    /// As configured, env references unfilled.
    public let url: String
    /// The service env var sent as the bearer token; empty when there is none.
    public let tokenEnv: String
    public let urlReadsEnv: Bool
    /// Every header, sorted by key.
    public let headers: [Header]
    /// The service env vars the URL and headers read, sorted; `tokenEnv` is not repeated.
    public let envReferences: [String]

    public init(
      url: String, tokenEnv: String, urlReadsEnv: Bool, headers: [Header], envReferences: [String]
    ) {
      self.url = url
      self.tokenEnv = tokenEnv
      self.urlReadsEnv = urlReadsEnv
      self.headers = headers
      self.envReferences = envReferences
    }

    /// Every service env var a connection sends, by name: the token's first, then the rest.
    public var sentEnv: [String] { (tokenEnv.isEmpty ? [] : [tokenEnv]) + envReferences }
  }

  public let serverId: String
  /// The server's own name: the plugin-local name of a plugin server, else `serverId`.
  public let name: String
  public let layer: Layer
  public let kind: Kind
  public let state: State
  public let plugin: Plugin?
  public let stdio: Stdio?
  public let http: Http?
  /// Opaque; the approve request echoes the one the user was shown.
  public let fingerprint: String

  public init(
    serverId: String, name: String, layer: Layer, kind: Kind, state: State, plugin: Plugin?,
    stdio: Stdio?, http: Http?, fingerprint: String
  ) {
    self.serverId = serverId
    self.name = name
    self.layer = layer
    self.kind = kind
    self.state = state
    self.plugin = plugin
    self.stdio = stdio
    self.http = http
    self.fingerprint = fingerprint
  }
}

/// `POST /v1/admin/approvals/mcp` (`McpLaunchApproveRequestSchema`): approves exactly what the
/// user was shown. The service recomputes the fingerprint and refuses a mismatch with 409.
public struct McpLaunchApproveRequest: Encodable, Equatable, Sendable {
  public let serverId: String
  public let fingerprint: String
  /// Who confirmed it; always the Swift shell here.
  public let via: String

  /// The request for the details the confirmation showed.
  public init(approving details: McpLaunchApprovalDetails) {
    serverId = details.serverId
    fingerprint = details.fingerprint
    via = "shell"
  }
}

/// The fields of `McpLaunchApproveResponseSchema` the shell reads.
public struct McpLaunchApproveResponse: Decodable, Equatable, Sendable {
  public struct Approval: Decodable, Equatable, Sendable {
    public let serverId: String
    public let fingerprint: String
    public let via: String
  }
  public let approval: Approval
}

/// What an approve came to.
public enum McpLaunchApproveOutcome: Equatable, Sendable {
  case approved
  /// What the server launches changed after the details were read (409 `approval_changed`).
  case changed

  /// The outcome a refused approve stands for, or nil for a refusal that is an error.
  public static func refusal(status: Int, code: String?) -> Self? {
    status == 409 && code == "approval_changed" ? .changed : nil
  }
}
