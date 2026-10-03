import Foundation
import Testing

@testable import AICore

@Suite("Files and folders handed to the app")
struct FolderImportTests {
  static func file(_ path: String) -> ImportItem {
    ImportItem(url: URL(filePath: path), isDirectory: false)
  }

  static func folder(_ path: String) -> ImportItem {
    ImportItem(url: URL(filePath: path, directoryHint: .isDirectory), isDirectory: true)
  }

  @Test("A gesture splits into files and folders, each in order and capped at 10")
  func splitAndCap() {
    let files = (1...12).map { Self.file("/f/\($0).md") }
    let folders = (1...11).map { Self.folder("/d/\($0)") }
    let web = ImportItem(url: URL(string: "https://example.com/a.md")!, isDirectory: false)
    let batch = ImportBatch(Array(zip(files, folders).flatMap { [$0, $1] }) + [files[11], web])
    #expect(batch.filePaths == (1...10).map { "/f/\($0).md" })
    #expect(batch.folderPaths == (1...10).map { "/d/\($0)/" })
    // 12 files and 11 folders: 2 + 1 left out; the web URL is not counted.
    #expect(batch.skipped == 3)
    #expect(!batch.isEmpty)
    #expect(ImportBatch([web]).isEmpty)
  }

  @Test("A link to a directory counts as a folder once the shell resolved it")
  func directoryFlagWins() {
    let link = ImportItem(url: URL(filePath: "/tmp/link"), isDirectory: true)
    let batch = ImportBatch([link])
    #expect(batch.files.isEmpty)
    #expect(batch.folderPaths == ["/tmp/link"])
  }

  @Test("The page gets one event: files, folders with their realpath, failures by basename")
  func combinedEvent() throws {
    let resource = ResourceRef(
      id: "r1", name: "a.md", size: 3, mime: "text/markdown", taskId: nil,
      createdAt: "2026-10-02T00:00:00.000Z")
    let event = ResourcesImportedEvent(
      files: ResourceImportResponse(
        imported: [.init(path: "/Users/me/a.md", resource: resource)],
        failures: [.init(path: "/Users/me/b.bin", reason: .unsupported, message: "no")]),
      folders: FolderRegisterResponse(
        registered: [
          .init(
            path: "/Users/me/Code/",
            folder: FolderRef(id: "fo_1", name: "Code", path: "/Users/me/Code"))
        ],
        failures: [
          .init(path: "/Users/me/", reason: .forbidden, message: "no"),
          .init(path: "/Users/me/x.txt", reason: .notDirectory, message: "no"),
        ]))
    #expect(event.resources.map(\.id) == ["r1"])
    #expect(event.folders == [.init(id: "fo_1", name: "Code", path: "/Users/me/Code")])
    #expect(
      event.failures == [
        .init(name: "b.bin", reason: .unsupported), .init(name: "me", reason: .forbidden),
        .init(name: "x.txt", reason: .notDirectory),
      ])
    let json = String(decoding: try JSONEncoder().encode(event), as: UTF8.self)
    #expect(!json.contains("/Users/me/b.bin"))
  }

  @Test("files.pickFolder answers the registration's refs and basenames")
  func pickFolderResult() {
    let result = FilesPickFolderResult(
      FolderRegisterResponse(
        registered: [
          .init(path: "/a/b", folder: FolderRef(id: "fo_2", name: "b", path: "/a/b"))
        ],
        failures: [.init(path: "/a/c", reason: .unreadable, message: "no")]))
    #expect(result.folders == [.init(id: "fo_2", name: "b", path: "/a/b")])
    #expect(result.failures == [.init(name: "c", reason: .unreadable)])
  }

  @Test("The registration response decodes the service contract")
  func decode() throws {
    let text = """
      {"registered":[{"path":"/a/b","folder":{"id":"fo_1","name":"b","path":"/a/b"}}],
      "failures":[{"path":"/","reason":"forbidden","message":"/ cannot be added."}]}
      """
    let response = try JSONDecoder().decode(FolderRegisterResponse.self, from: Data(text.utf8))
    #expect(response.registered.first?.folder.id == "fo_1")
    #expect(response.failures.first?.reason == .forbidden)
  }

  @Test("A drag counts folders as attachable, within the batch's limits")
  func dragSummary() {
    let mixed = FileDragSummary(items: [
      Self.file("/a.md"), Self.file("/b.bin"), Self.folder("/src"), Self.folder("/docs"),
    ])
    #expect(mixed.files == 4)
    #expect(mixed.attachable == 3)
    let many = FileDragSummary(
      items: (1...12).map { Self.folder("/d\($0)") } + (1...12).map { Self.file("/f\($0).txt") })
    #expect(many.files == 24)
    #expect(many.attachable == 20)
    #expect(FileDragSummary(items: [Self.file("/a.bin")]).attachable == 0)
  }
}
