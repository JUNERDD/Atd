import Foundation

public enum SharedStoreError: Error, Equatable {
  case unsupportedSchema(file: String, version: Int)
}

/// A document as read from disk, with where it came from.
public struct Snapshot<Document: SharedDocument>: Sendable, Equatable {
  public enum Source: Sendable, Equatable {
    /// Read from the file.
    case stored
    /// No file yet: `document` is the initial content.
    case missing
    /// The file could not be read (damaged, or a schema this build does not know): `document` is
    /// the initial content and the next write keeps a copy of the file before replacing it.
    case unreadable
  }

  public var document: Document
  /// The file's revision; 0 when nothing was stored.
  public var revision: Int
  public var source: Source
}

/// Reads and writes the shared JSON documents in one directory: the App Group's for the app and a
/// keyboard with Full Access, or the keyboard's own container for its offline copies.
///
/// Every write is one coordinated read-modify-write (NSFileCoordinator) that replaces the file
/// atomically, so the app and the keyboard changing the same file each apply their change to the
/// latest content. After a write the store posts its Darwin notification, and the other process
/// reloads.
public struct SharedStore: Sendable {
  public let directory: URL
  /// Posted after every write; nil for a store only one process uses.
  public let notificationName: String?

  public init(directory: URL, notificationName: String?) {
    self.directory = directory
    self.notificationName = notificationName
  }

  /// The App Group's store, or nil when this process cannot reach the group (a keyboard without
  /// Full Access, tests).
  public static func appGroup(_ group: AppGroup, fileManager: FileManager = .default)
    -> SharedStore?
  {
    guard let directory = group.directory(fileManager: fileManager) else { return nil }
    return SharedStore(directory: directory, notificationName: group.changeNotificationName)
  }

  public func url<Document: SharedDocument>(for type: Document.Type) -> URL {
    directory.appending(path: Document.fileName, directoryHint: .notDirectory)
  }

  public func load<Document: SharedDocument>(_ type: Document.Type = Document.self)
    -> Snapshot<Document>
  {
    let url = url(for: type)
    var data: Data?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) {
      data = try? Data(contentsOf: $0)
    }
    guard let data else {
      let exists = FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
      return Snapshot(
        document: Document.initial(), revision: 0, source: exists ? .unreadable : .missing)
    }
    return Self.decode(data, as: type)
  }

  /// Applies `change` to the latest stored document and writes the result, unless it left the
  /// document as it was. Returns what is now stored.
  @discardableResult
  public func update<Document: SharedDocument>(
    _ type: Document.Type = Document.self, _ change: (inout Document) throws -> Void
  ) throws -> Snapshot<Document> {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = url(for: type)
    var result: Result<(Snapshot<Document>, wrote: Bool), Error>?
    var coordinationError: NSError?
    NSFileCoordinator().coordinate(
      writingItemAt: url, options: .forMerging, error: &coordinationError
    ) { url in
      result = Result { try Self.readModifyWrite(url, as: type, change) }
    }
    if let coordinationError { throw coordinationError }
    guard let result else { throw CocoaError(.fileWriteUnknown) }
    let (snapshot, wrote) = try result.get()
    if wrote, let notificationName { DarwinNotification.post(notificationName) }
    return snapshot
  }

  /// Writes the initial document when none is stored yet, so both processes start from the same
  /// content (the built-in commands in the language the app first ran in).
  public func createIfMissing<Document: SharedDocument>(_ type: Document.Type) throws {
    guard load(type).source == .missing else { return }
    try update(type) { _ in }
  }

  private static func readModifyWrite<Document: SharedDocument>(
    _ url: URL, as type: Document.Type, _ change: (inout Document) throws -> Void
  ) throws -> (Snapshot<Document>, wrote: Bool) {
    let stored = try? Data(contentsOf: url)
    var current =
      stored.map { decode($0, as: type) }
      ?? Snapshot(document: Document.initial(), revision: 0, source: .missing)
    if current.source == .unreadable, let stored {
      // Keep the damaged file next to the new one instead of overwriting it.
      try stored.write(to: archiveURL(for: url), options: .atomic)
    }
    var document = current.document
    try change(&document)
    if current.source == .stored, document == current.document { return (current, false) }
    let revision = current.revision + 1
    let file = Envelope(schemaVersion: Document.schemaVersion, revision: revision, body: document)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(file).write(to: url, options: .atomic)
    current = Snapshot(document: document, revision: revision, source: .stored)
    return (current, true)
  }

  static func decode<Document: SharedDocument>(_ data: Data, as type: Document.Type)
    -> Snapshot<Document>
  {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let header = try? decoder.decode(Header.self, from: data) else {
      return Snapshot(document: Document.initial(), revision: 0, source: .unreadable)
    }
    let document: Document?
    if header.schemaVersion == Document.schemaVersion {
      document = try? decoder.decode(Envelope<Document>.self, from: data).body
    } else if header.schemaVersion < Document.schemaVersion {
      document = try? Document.migrate(data, from: header.schemaVersion)
    } else {
      document = nil
    }
    guard let document else {
      return Snapshot(document: Document.initial(), revision: header.revision, source: .unreadable)
    }
    return Snapshot(document: document, revision: header.revision, source: .stored)
  }

  /// `library.json` → `library.unreadable-20261120T101500.json` (UTC).
  static func archiveURL(for url: URL, at date: Date = .now) -> URL {
    let stamp = date.formatted(
      .iso8601.year().month().day().time(includingFractionalSeconds: false)
    )
    .replacingOccurrences(of: ":", with: "")
    .replacingOccurrences(of: "-", with: "")
    let name = url.deletingPathExtension().lastPathComponent
    return url.deletingLastPathComponent()
      .appending(path: "\(name).unreadable-\(stamp).\(url.pathExtension)")
  }
}

/// The on-disk wrapper of every shared document.
struct Envelope<Body: Codable>: Codable {
  var schemaVersion: Int
  var revision: Int
  var body: Body
}

private struct Header: Decodable {
  var schemaVersion: Int
  var revision: Int
}
