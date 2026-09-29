import Foundation
import Testing

@testable import AICore

@Suite("Attachments, capability inputs and artifacts")
struct ShellResourcesTests {
  static func resource(_ id: String) -> ResourceRef {
    ResourceRef(
      id: id, name: "\(id).md", size: 3, mime: "text/plain", taskId: nil,
      createdAt: "2026-09-29T00:00:00.000Z")
  }

  @Test("Imports go out in calls of at most ten paths")
  func batches() {
    let paths = (1...23).map { "/tmp/\($0).txt" }
    let batches = AttachmentRules.importBatches(paths)
    #expect(batches.map(\.count) == [10, 10, 3])
    #expect(batches.flatMap(\.self) == paths)
    #expect(AttachmentRules.importBatches([]).isEmpty)
  }

  @Test("The page gets resources and basenames, never absolute paths")
  func pageResult() throws {
    let merged = AttachmentRules.merge([
      ResourceImportResponse(
        imported: [.init(path: "/Users/me/a.md", resource: Self.resource("r1"))], failures: []),
      ResourceImportResponse(
        imported: [],
        failures: [.init(path: "/Users/me/pic.png", reason: .unsupported, message: "no")]),
    ])
    let result = AttachmentImportResult(merged)
    #expect(result.resources == [Self.resource("r1")])
    #expect(result.failures.map(\.name) == ["pic.png"])
    let json = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
    #expect(!json.contains("/Users/me"))
    #expect(json.contains("\"taskId\":null"))
  }

  @Test("The import response decodes the service contract")
  func decode() throws {
    let text = """
      {"imported":[{"path":"/a/b.md","resource":{"id":"r1","name":"b.md","size":3,\
      "mime":"text/plain","taskId":null,"createdAt":"2026-09-29T00:00:00.000Z"}}],
      "failures":[{"path":"/a/c.bin","reason":"tooLarge","message":"c.bin is too large."}]}
      """
    let response = try JSONDecoder().decode(ResourceImportResponse.self, from: Data(text.utf8))
    #expect(response.imported.first?.resource.id == "r1")
    #expect(response.failures.first?.reason == .tooLarge)
  }

  @Test("basename matches Node's for POSIX paths")
  func basename() {
    #expect(AttachmentRules.basename("/a/b/c.txt") == "c.txt")
    #expect(AttachmentRules.basename("c.txt") == "c.txt")
    #expect(AttachmentRules.basename("/a/b/") == "b")
  }

  static func save(_ name: String, _ content: String) -> JSONValue {
    .object(["name": .string(name), "contentBase64": .string(content)])
  }

  @Test("file.save validates the name and base64 like Electron")
  func fileSave() {
    #expect(
      CapabilityInputs.fileSave(Self.save("../x/report.txt", "aGk="))
        == .success(.init(suggestedName: "report.txt", bytes: Data("hi".utf8))))
    #expect(
      CapabilityInputs.fileSave(Self.save(" ", "aGk=")).failureMessage == "Enter a file name.")
    #expect(
      CapabilityInputs.fileSave(Self.save("a", "")).failureMessage
        == "The file content is missing or too large to save over the desktop.")
    for bad in ["aGk", "a===", "=aGk", "aG-k"] {
      #expect(
        CapabilityInputs.fileSave(Self.save("a", bad)).failureMessage
          == "file.save content is not valid base64.")
    }
    let long = String(repeating: "A", count: 700_004)
    #expect(CapabilityInputs.fileSave(Self.save("a", long)).failureMessage != nil)
  }

  @Test("clipboard.write needs text within the limit")
  func clipboardWrite() {
    #expect(CapabilityInputs.clipboardWrite(.object(["text": .string("x")])) == .success("x"))
    #expect(
      CapabilityInputs.clipboardWrite(.null).failureMessage == "Nothing to write to the clipboard.")
    let long = String(repeating: "😀", count: 500_001)
    #expect(
      CapabilityInputs.clipboardWrite(.object(["text": .string(long)])).failureMessage
        == "Clipboard content exceeds the limit.")
  }

  @Test("Artifact file names are safe and bounded")
  func artifactNames() {
    #expect(ArtifactFiles.fileName(artifactId: "a1", name: "x/y:z?.md") == "a1-x_y_z_.md")
    #expect(ArtifactFiles.fileName(artifactId: "a1", name: "") == "a1-download.bin")
    let long = ArtifactFiles.fileName(artifactId: "a", name: String(repeating: "😀", count: 150))
    #expect(long.utf16.count == 2 + 200)
  }

  @Test("The menu bar state ranks unavailable, attention, running, idle")
  func menuBarState() {
    #expect(MenuBarStatus(availability: .available, running: 0, attention: 0).state == .idle)
    #expect(MenuBarStatus(availability: .available, running: 2, attention: 0).state == .running)
    #expect(MenuBarStatus(availability: .connecting, running: 2, attention: 1).state == .attention)
    let down = MenuBarStatus(
      availability: .unavailable(development: true), running: 2, attention: 1)
    #expect(down.state == .unavailable && down.developmentHint)
    #expect(
      MenuBarState.allCases.map(\.rawValue) == ["unavailable", "attention", "running", "idle"])
  }
}

extension Result where Failure == CapabilityInputs.InputError {
  var failureMessage: String? {
    if case .failure(let error) = self { return error.message }
    return nil
  }
}
