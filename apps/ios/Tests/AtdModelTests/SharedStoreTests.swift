import Foundation
import Testing

@testable import AtdModel

@Suite struct SharedStoreTests {
  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "SharedStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  private var store: SharedStore { SharedStore(directory: directory, notificationName: nil) }

  @Test func missingFilesReadAsTheInitialContent() {
    let snapshot = store.load(CommandLibrary.self)
    #expect(snapshot.source == .missing)
    #expect(snapshot.revision == 0)
    #expect(snapshot.document == .initial())
  }

  @Test func updatesBumpTheRevisionAndSkipNoChange() throws {
    try store.createIfMissing(PhraseBook.self)
    #expect(store.load(PhraseBook.self).revision == 1)
    try store.update(PhraseBook.self) { $0.phrases.append(Phrase(id: "x", title: "t", text: "x")) }
    let changed = store.load(PhraseBook.self)
    #expect(changed.revision == 2)
    #expect(changed.document.phrases.last?.id == "x")
    try store.update(PhraseBook.self) { _ in }
    #expect(store.load(PhraseBook.self).revision == 2)
    try store.createIfMissing(PhraseBook.self)
    #expect(store.load(PhraseBook.self).revision == 2)
  }

  @Test func concurrentWritersAllLand() async throws {
    try store.createIfMissing(PhraseBook.self)
    // Two stores on one directory stand in for the app and the keyboard.
    let writers = [store, SharedStore(directory: directory, notificationName: nil)]
    await withTaskGroup(of: Void.self) { group in
      for index in 0..<40 {
        let writer = writers[index % 2]
        group.addTask {
          _ = try? writer.update(PhraseBook.self) {
            $0.phrases.append(Phrase(id: "p\(index)", title: "\(index)", text: "\(index)"))
          }
        }
      }
    }
    let stored = store.load(PhraseBook.self)
    #expect(Set(stored.document.phrases.map(\.id)).isSuperset(of: (0..<40).map { "p\($0)" }))
    #expect(stored.revision == 41)
  }

  @Test func unreadableFilesAreKeptAndReplacedOnTheNextWrite() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = store.url(for: CommandLibrary.self)
    try Data("{ not json".utf8).write(to: url)
    let damaged = store.load(CommandLibrary.self)
    #expect(damaged.source == .unreadable)
    #expect(damaged.document == .initial())

    try store.update(CommandLibrary.self) { $0.remove(BuiltinCommands.shortenID) }
    let repaired = store.load(CommandLibrary.self)
    #expect(repaired.source == .stored)
    #expect(repaired.document.command(BuiltinCommands.shortenID) == nil)
    let archived = try FileManager.default.contentsOfDirectory(atPath: directory.path())
      .filter { $0.hasPrefix("library.unreadable-") }
    #expect(archived.count == 1)
    let kept = try Data(contentsOf: directory.appending(path: archived[0]))
    #expect(String(decoding: kept, as: UTF8.self) == "{ not json")
  }

  @Test func newerSchemasAreNotRead() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = #"{"schemaVersion":99,"revision":7,"body":{"phrases":[]}}"#
    try Data(file.utf8).write(to: store.url(for: PhraseBook.self))
    let snapshot = store.load(PhraseBook.self)
    #expect(snapshot.source == .unreadable)
    #expect(snapshot.document == .initial())
  }

  @Test func olderSchemasMigrate() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let old = #"{"schemaVersion":1,"revision":4,"body":{"names":["a","b"]}}"#
    try Data(old.utf8).write(to: store.url(for: Tags.self))
    let migrated = store.load(Tags.self)
    #expect(migrated.source == .stored)
    #expect(migrated.revision == 4)
    #expect(migrated.document.tags == [Tags.Tag(name: "a"), Tags.Tag(name: "b")])
    try store.update(Tags.self) { $0.tags.append(Tags.Tag(name: "c")) }
    let rewritten = try String(contentsOf: store.url(for: Tags.self), encoding: .utf8)
    #expect(rewritten.contains(#""schemaVersion":2"#))
  }

  @Test func archiveNamesKeepTheExtension() {
    let url = URL(filePath: "/tmp/library.json")
    let archive = SharedStore.archiveURL(for: url, at: Date(timeIntervalSince1970: 0))
    #expect(archive.lastPathComponent == "library.unreadable-19700101T000000.json")
  }
}

/// A document whose schema 2 replaced schema 1's plain names with tag records.
private struct Tags: SharedDocument {
  struct Tag: Codable, Equatable { var name: String }
  static let fileName = "tags.json"
  static let schemaVersion = 2
  var tags: [Tag]

  static func initial() -> Tags { Tags(tags: []) }

  static func migrate(_ file: Data, from version: Int) throws -> Tags {
    struct Old: Decodable { var body: Body }
    struct Body: Decodable { var names: [String] }
    let old = try JSONDecoder().decode(Old.self, from: file)
    return Tags(tags: old.body.names.map(Tag.init(name:)))
  }
}
