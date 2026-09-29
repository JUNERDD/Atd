/// A stored resource (`ResourceRefSchema` in packages/agent-contracts/src/resources.ts).
public struct ResourceRef: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let size: Int
  public let mime: String
  public let taskId: String?
  public let createdAt: String

  public init(
    id: String, name: String, size: Int, mime: String, taskId: String?, createdAt: String
  ) {
    self.id = id
    self.name = name
    self.size = size
    self.mime = mime
    self.taskId = taskId
    self.createdAt = createdAt
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(name, forKey: .name)
    try container.encode(size, forKey: .size)
    try container.encode(mime, forKey: .mime)
    // The contract's `taskId` is `Identifier | null`, never absent.
    try container.encode(taskId, forKey: .taskId)
    try container.encode(createdAt, forKey: .createdAt)
  }
}

/// Why the service did not import a path (`ResourceImportFailureReasonSchema`).
public enum ResourceImportFailureReason: String, Codable, Equatable, Sendable {
  case unreadable
  case unsupported
  case tooLarge
}

/// The answer of `POST /v1/resources/import` (`ResourceImportResponseSchema`). Every requested
/// path lands in exactly one list; both keep request order.
public struct ResourceImportResponse: Codable, Equatable, Sendable {
  public struct Imported: Codable, Equatable, Sendable {
    public let path: String
    public let resource: ResourceRef

    public init(path: String, resource: ResourceRef) {
      self.path = path
      self.resource = resource
    }
  }

  public struct Failure: Codable, Equatable, Sendable {
    public let path: String
    public let reason: ResourceImportFailureReason
    /// English, naming only the file's basename.
    public let message: String

    public init(path: String, reason: ResourceImportFailureReason, message: String) {
      self.path = path
      self.reason = reason
      self.message = message
    }
  }

  public var imported: [Imported]
  public var failures: [Failure]

  public init(imported: [Imported], failures: [Failure]) {
    self.imported = imported
    self.failures = failures
  }
}

/// What the page receives for an attachment import. Absolute paths stay in the shell (the
/// Electron rule for attachments): a failure names the file by its basename only.
public struct AttachmentImportResult: Codable, Equatable, Sendable {
  public struct Failure: Codable, Equatable, Sendable {
    public let name: String
    public let reason: ResourceImportFailureReason
    public let message: String
  }

  public let resources: [ResourceRef]
  public let failures: [Failure]

  public init(_ response: ResourceImportResponse) {
    resources = response.imported.map(\.resource)
    failures = response.failures.map {
      Failure(name: AttachmentRules.basename($0.path), reason: $0.reason, message: $0.message)
    }
  }
}

/// Attachment limits the shell applies before asking the service (packages/agent-contracts/src/
/// attachments.ts). The service applies the format and size rules to the file it resolves.
public enum AttachmentRules {
  /// Paths per import call (`ResourceImportRequestSchema.paths.maxItems`, `MAX_ATTACHMENTS`).
  public static let maxPathsPerImport = 10
  /// Text formats the service reads back as run material (`ATTACHABLE_EXTENSIONS`). Images are
  /// not among them, so a pasted bitmap cannot become an attachment.
  public static let extensions = [
    "txt", "md", "csv", "json", "log", "yaml", "yml", "xml", "html", "css", "ts", "tsx", "js",
    "py",
  ]

  /// Splits paths into import calls the service accepts, keeping their order.
  public static func importBatches(_ paths: [String]) -> [[String]] {
    stride(from: 0, to: paths.count, by: maxPathsPerImport).map {
      Array(paths[$0..<min($0 + maxPathsPerImport, paths.count)])
    }
  }

  /// Joins the answers of consecutive import calls, keeping request order.
  public static func merge(_ responses: [ResourceImportResponse]) -> ResourceImportResponse {
    ResourceImportResponse(
      imported: responses.flatMap(\.imported), failures: responses.flatMap(\.failures))
  }

  /// Node's `path.basename` for the POSIX paths the shell imports.
  public static func basename(_ path: String) -> String {
    let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
    return trimmed.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init)
      ?? trimmed
  }
}
