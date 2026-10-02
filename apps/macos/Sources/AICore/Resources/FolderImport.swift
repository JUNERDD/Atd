import Foundation

/// A registered folder (`FolderRefSchema` in packages/agent-contracts/src/folders.ts): `path` is
/// the realpath the service resolved, `name` its basename. Registering the same realpath again
/// answers the same `id`.
public struct FolderRef: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let path: String

  public init(id: String, name: String, path: String) {
    self.id = id
    self.name = name
    self.path = path
  }
}

/// Why the service did not register a folder (`FolderRegisterFailureReasonSchema`): it could
/// not be read, it is not a directory, or no task may read it (`/`, the home folder itself, the
/// service's data directory or anything inside it).
public enum FolderRegisterFailureReason: String, Codable, Equatable, Sendable {
  case unreadable
  case notDirectory
  case forbidden
}

/// The answer of `POST /v1/folders/register` (`FolderRegisterResponseSchema`). Every requested
/// path lands in exactly one list; both keep request order.
public struct FolderRegisterResponse: Codable, Equatable, Sendable {
  public struct Registered: Codable, Equatable, Sendable {
    public let path: String
    public let folder: FolderRef

    public init(path: String, folder: FolderRef) {
      self.path = path
      self.folder = folder
    }
  }

  public struct Failure: Codable, Equatable, Sendable {
    public let path: String
    public let reason: FolderRegisterFailureReason
    /// English, naming only the folder's basename.
    public let message: String

    public init(path: String, reason: FolderRegisterFailureReason, message: String) {
      self.path = path
      self.reason = reason
      self.message = message
    }
  }

  public var registered: [Registered]
  public var failures: [Failure]

  public init(registered: [Registered], failures: [Failure]) {
    self.registered = registered
    self.failures = failures
  }
}

/// One file or folder the user handed the app: dropped on the panel, sent by the Finder
/// service, dropped on the Dock icon or opened with `open -a`, or picked in an open panel.
/// `isDirectory` is what the file system says after following links; the shell reads it once.
public struct ImportItem: Equatable, Sendable {
  public let url: URL
  public let isDirectory: Bool

  public init(url: URL, isDirectory: Bool) {
    self.url = url
    self.isDirectory = isDirectory
  }
}

/// What one gesture imports: its files through `/v1/resources/import` and its folders through
/// `/v1/folders/register`, each list in the order given and cut to what one request takes
/// (``AttachmentRules/maxPathsPerImport`` files, ``maxFolders`` folders, the page's limits).
/// URLs that are not file URLs are ignored.
public struct ImportBatch: Equatable, Sendable {
  /// `MAX_FOLDERS`: folders one message carries and one registration takes.
  public static let maxFolders = 10

  public let files: [URL]
  public let folders: [URL]
  /// Items past either limit, which the batch leaves out.
  public let skipped: Int

  public init(_ items: [ImportItem]) {
    let local = items.filter(\.url.isFileURL)
    let files = local.filter { !$0.isDirectory }.map(\.url)
    let folders = local.filter(\.isDirectory).map(\.url)
    self.files = Array(files.prefix(AttachmentRules.maxPathsPerImport))
    self.folders = Array(folders.prefix(Self.maxFolders))
    skipped = local.count - self.files.count - self.folders.count
  }

  public var isEmpty: Bool { files.isEmpty && folders.isEmpty }

  /// The absolute paths each request carries.
  public var filePaths: [String] { files.map(Self.path) }
  public var folderPaths: [String] { folders.map(Self.path) }

  private static func path(_ url: URL) -> String {
    url.standardizedFileURL.path(percentEncoded: false)
  }
}

extension ResourcesImportedEvent {
  /// What the panel page receives for one gesture: the stored files, the registered folders
  /// (with the realpath their chip shows) and, for refused paths, the basename only.
  public init(files: ResourceImportResponse, folders: FolderRegisterResponse) {
    self.init(
      resources: files.imported.map { FileRef($0.resource) },
      folders: folders.registered.map {
        Folder(id: $0.folder.id, name: $0.folder.name, path: $0.folder.path)
      },
      failures: files.failures.map {
        Failure(name: AttachmentRules.basename($0.path), reason: Failure.Reason($0.reason))
      }
        + folders.failures.map {
          Failure(name: AttachmentRules.basename($0.path), reason: Failure.Reason($0.reason))
        })
  }
}

extension FilesPickFolderResult {
  /// `files.pickFolder`'s answer for the picked folders' registration.
  public init(_ response: FolderRegisterResponse) {
    self.init(
      folders: response.registered.map {
        Folder(id: $0.folder.id, name: $0.folder.name, path: $0.folder.path)
      },
      failures: response.failures.map {
        Failure(name: AttachmentRules.basename($0.path), reason: Failure.Reason($0.reason))
      })
  }
}

extension FilesPickFolderResult.Failure.Reason {
  init(_ reason: FolderRegisterFailureReason) {
    switch reason {
    case .unreadable: self = .unreadable
    case .notDirectory: self = .notDirectory
    case .forbidden: self = .forbidden
    }
  }
}

extension ResourcesImportedEvent.Failure.Reason {
  init(_ reason: FolderRegisterFailureReason) {
    switch reason {
    case .unreadable: self = .unreadable
    case .notDirectory: self = .notDirectory
    case .forbidden: self = .forbidden
    }
  }
}

extension ResourceImportResponse {
  /// No files: a gesture that carried only folders.
  public static let empty = ResourceImportResponse(imported: [], failures: [])
}

extension FolderRegisterResponse {
  /// No folders: a gesture that carried only files.
  public static let empty = FolderRegisterResponse(registered: [], failures: [])
}
