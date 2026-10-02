import Foundation
import Testing

@testable import AICore

@Suite("Pasted images")
struct PastedImageTests {
  @Test("File URLs paste as files, a bitmap alone as an image, anything with text stays WebKit's")
  func route() {
    func route(_ files: Bool, _ text: Bool, _ image: Bool) -> PasteboardPaste.Route {
      PasteboardPaste.route(hasFileURLs: files, hasText: text, hasImage: image)
    }
    #expect(route(true, false, true) == .files)
    #expect(route(true, true, false) == .files)
    #expect(route(false, false, true) == .image)
    #expect(route(false, true, true) == .webKit)
    #expect(route(false, true, false) == .webKit)
    #expect(route(false, false, false) == .webKit)
  }

  @Test("The name follows the screenshot's shape in the given time zone")
  func fileName() throws {
    let utc = try #require(TimeZone(identifier: "UTC"))
    let date = Date(timeIntervalSince1970: 1_790_849_771)
    let name = PastedImageName.fileName(pastedAt: date, timeZone: utc)
    #expect(name == "Pasted image 2026-10-01 at 10.16.11.png")
    #expect(
      PastedImageName.fileName(pastedAt: date, encoding: .jpeg, timeZone: utc).hasSuffix(".jpg"))
  }
}
