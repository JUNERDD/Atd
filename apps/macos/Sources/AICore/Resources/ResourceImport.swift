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

extension ResourcesImportedEvent {
  /// What the panel page receives for an import: the stored files and, for refused paths, the
  /// basename only. Absolute paths stay in the shell.
  public init(_ response: ResourceImportResponse) {
    self.init(
      resources: response.imported.map { FileRef($0.resource) },
      failures: response.failures.map {
        Failure(name: AttachmentRules.basename($0.path), reason: Failure.Reason($0.reason))
      })
  }
}

extension FileRef {
  /// A stored resource as the page's `FileRef`.
  public init(_ resource: ResourceRef) {
    self.init(id: resource.id, name: resource.name, size: resource.size, type: resource.mime)
  }
}

extension ResourcesImportedEvent.Failure.Reason {
  init(_ reason: ResourceImportFailureReason) {
    switch reason {
    case .unreadable: self = .unreadable
    case .unsupported: self = .unsupported
    case .tooLarge: self = .tooLarge
    }
  }
}

/// Attachment limits the shell applies before asking the service (packages/agent-contracts/src/
/// attachments.ts). The service applies the format and size rules to the file it resolves.
public enum AttachmentRules {
  /// Paths per import call (`ResourceImportRequestSchema.paths.maxItems`, `MAX_ATTACHMENTS`),
  /// which is also the most the page takes from one pick, drop or paste.
  public static let maxPathsPerImport = 10
  /// Text formats the service reads back as run material (`ATTACHABLE_EXTENSIONS`). Images are
  /// not among them, so a pasted bitmap cannot become an attachment.
  public static let extensions = [
    "txt", "md", "csv", "json", "log", "yaml", "yml", "xml", "html", "css", "ts", "tsx", "js",
    "py",
  ]

  /// Node's `path.basename` for the POSIX paths the shell imports.
  public static func basename(_ path: String) -> String {
    let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
    return trimmed.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init)
      ?? trimmed
  }
}
