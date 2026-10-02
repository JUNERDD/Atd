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

  @Test("The page gets file refs and basenames, never absolute paths")
  func pageResult() throws {
    let event = ResourcesImportedEvent(
      files: ResourceImportResponse(
        imported: [.init(path: "/Users/me/a.md", resource: Self.resource("r1"))],
        failures: [.init(path: "/Users/me/pic.png", reason: .unsupported, message: "no")]),
      folders: .empty)
    #expect(event.resources == [FileRef(id: "r1", name: "r1.md", size: 3, type: "text/plain")])
    #expect(event.failures == [.init(name: "pic.png", reason: .unsupported)])
    let json = String(decoding: try JSONEncoder().encode(event), as: UTF8.self)
    #expect(!json.contains("/Users/me"))
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

  @Test("files.save suggests a visible basename and writes only real PNG bytes as an image")
  func savedFile() throws {
    typealias Outcome = Result<SavedFile, SavedFile.Failure>
    func check(_ name: String, _ content: FilesSaveParams.Content) -> Outcome {
      SavedFile.validate(FilesSaveParams(name: name, content: content))
    }
    let text = try check("../a/code.py", .text(.init(text: "print(1)"))).get()
    #expect(text == SavedFile(suggestedName: "code.py", bytes: Data("print(1)".utf8), isPNG: false))
    #expect(try check(" ..", .text(.init(text: ""))).get().suggestedName == "download.txt")
    let png = SavedFile.pngSignature + Data([1, 2, 3])
    let image = try check("diagram", .png(.init(base64: png.base64EncodedString()))).get()
    #expect(image == SavedFile(suggestedName: "diagram.png", bytes: png, isPNG: true))
    #expect(
      try check("a.PNG", .png(.init(base64: png.base64EncodedString()))).get().suggestedName
        == "a.PNG")
    let notPNG = Data("<svg/>".utf8).base64EncodedString()
    #expect(check("a.png", .png(.init(base64: notPNG))) == .failure(.invalidImage))
    #expect(check("a.png", .png(.init(base64: "not base64!"))) == .failure(.invalidImage))
  }

  @Test("A screenshot scales down only when its long edge exceeds 2560 px")
  func screenshotScaling() {
    #expect(ScreenshotRules.scaledLongEdge(width: 5120, height: 2880) == 2560)
    #expect(ScreenshotRules.scaledLongEdge(width: 1200, height: 4000) == 2560)
    #expect(ScreenshotRules.scaledLongEdge(width: 2560, height: 1600) == nil)
    #expect(ScreenshotRules.scaledLongEdge(width: 40, height: 30) == nil)
  }

  @Test("The size label shows points, and the stored pixels when they differ")
  func screenshotSizeLabel() {
    func label(_ rect: CGRect, scale: CGFloat, image: (Int, Int)) -> String {
      ScreenshotRules.sizeLabel(
        selection: rect, scale: scale, imageWidth: image.0, imageHeight: image.1)
    }
    let area = CGRect(x: 10, y: 20, width: 400, height: 300)
    // A 1x capture stores what it shows; a Retina one stores twice the points.
    #expect(label(area, scale: 1, image: (1920, 1080)) == "400 × 300")
    #expect(label(area, scale: 2, image: (3024, 1964)) == "400 × 300 · 800 × 600 px")
    // The 2560 px long-edge cap applies to 1x and Retina alike.
    let whole = CGRect(x: 0, y: 0, width: 1512, height: 982)
    #expect(label(whole, scale: 2, image: (3024, 1964)) == "1512 × 982 · 2560 × 1663 px")
    let wide = CGRect(x: 0, y: 0, width: 3000, height: 1000)
    #expect(label(wide, scale: 1, image: (3000, 1000)) == "3000 × 1000 · 2560 × 853 px")
    // Fractional points round for the label; a selection past the image shows what is left.
    #expect(
      label(CGRect(x: 0, y: 0, width: 99.5, height: 50), scale: 2, image: (400, 400))
        == "100 × 50 · 199 × 100 px")
    #expect(
      label(CGRect(x: 90, y: 0, width: 50, height: 10), scale: 1, image: (100, 100))
        == "50 × 10 · 10 × 10 px")
  }

  @Test("The stored size is the first attempt's, so the label and the file agree")
  func screenshotExportSize() {
    for (width, height) in [(3024, 1964), (800, 600), (6016, 3384), (10, 5000)] {
      let first = ScreenshotRules.firstAttempt(width: width, height: height)
      #expect(
        ScreenshotRules.exportSize(width: width, height: height)
          == ScreenshotRules.pixelSize(width: width, height: height, longEdge: first.longEdge))
    }
  }

  @Test("A screenshot is named like the system's, in the given time zone")
  func screenshotName() throws {
    let date = try Date.ISO8601FormatStyle().parse("2026-10-01T02:16:11Z")
    let shanghai = try #require(TimeZone(identifier: "Asia/Shanghai"))
    #expect(
      ScreenshotRules.fileName(capturedAt: date, timeZone: shanghai)
        == "Screenshot 2026-10-01 at 10.16.11.png")
    #expect(
      ScreenshotRules.fileName(capturedAt: date, timeZone: .gmt)
        == "Screenshot 2026-10-01 at 02.16.11.png")
    #expect(
      ScreenshotRules.contextFileName(capturedAt: date, timeZone: shanghai)
        == "Screenshot 2026-10-01 at 10.16.11 context.md")
  }

  static func save(_ name: String, _ content: String) -> JSONValue {
    .object(["name": .string(name), "contentBase64": .string(content)])
  }

  @Test("file.save validates the name and base64")
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
