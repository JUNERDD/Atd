import Foundation
import Testing

@testable import AICore

@Suite("Mini panel drops")
struct MiniPanelDropTests {
  static func offer(
    files: Bool = false, promises: Bool = false, image: Bool = false, text: Bool = false,
    fromAtd: Bool = false
  ) -> MiniPanelDragOffer {
    MiniPanelDragOffer(
      files: files, promises: promises, image: image, text: text, fromAtd: fromAtd)
  }

  @Test("Only a drag carrying something the panel takes, from another app, is invited")
  func invites() {
    #expect(Self.offer(files: true).isAcceptable)
    #expect(Self.offer(promises: true).isAcceptable)
    #expect(Self.offer(image: true).isAcceptable)
    #expect(Self.offer(text: true).isAcceptable)
    #expect(!Self.offer().isAcceptable)
    #expect(!Self.offer(files: true, image: true, text: true, fromAtd: true).isAcceptable)
  }

  @Test("Files beat promises, which beat images, which beat text")
  func precedence() {
    let all = Self.offer(files: true, promises: true, image: true, text: true)
    #expect(MiniPanelDropRoute.route(for: all, text: "hi") == .files)
    #expect(
      MiniPanelDropRoute.route(
        for: Self.offer(promises: true, image: true, text: true), text: "hi") == .promises)
    #expect(
      MiniPanelDropRoute.route(for: Self.offer(image: true, text: true), text: "hi") == .image)
    #expect(MiniPanelDropRoute.route(for: Self.offer(text: true), text: "hi") == .quote("hi"))
  }

  @Test("Atd's own drags, empty drops and whitespace take no route")
  func nothingToTake() {
    #expect(MiniPanelDropRoute.route(for: Self.offer(files: true, fromAtd: true), text: nil) == nil)
    #expect(MiniPanelDropRoute.route(for: Self.offer(), text: "hi") == nil)
    #expect(MiniPanelDropRoute.route(for: Self.offer(text: true), text: nil) == nil)
    #expect(MiniPanelDropRoute.route(for: Self.offer(text: true), text: " \n\t") == nil)
  }

  @Test("Text up to 12 000 UTF-16 units is quoted; longer text becomes a file")
  func textLength() {
    let offer = Self.offer(text: true)
    // 6 000 emoji are 12 000 UTF-16 units: at the quote limit.
    let atLimit = String(repeating: "😀", count: 6_000)
    #expect(MiniPanelDropRoute.route(for: offer, text: atLimit) == .quote(atLimit))
    let over = atLimit + "a"
    #expect(MiniPanelDropRoute.route(for: offer, text: over) == .textFile(over))
    #expect(MiniPanelDropRoute.maxQuoteLength == 12_000)
  }

  @Test("The log names the route, never the content")
  func logNames() {
    #expect(MiniPanelDropRoute.files.logName == "files")
    #expect(MiniPanelDropRoute.promises.logName == "promise")
    #expect(MiniPanelDropRoute.image.logName == "image")
    #expect(MiniPanelDropRoute.quote("secret").logName == "text-quote")
    #expect(MiniPanelDropRoute.textFile("secret").logName == "text-file")
  }

  @Test("Long dropped text is named like a pasted image")
  func textFileName() throws {
    let date = Date(timeIntervalSince1970: 1_790_000_000.5)
    let utc = try #require(TimeZone(identifier: "UTC"))
    #expect(
      MiniPanelDroppedText.fileName(droppedAt: date, timeZone: utc)
        == "Dropped text 2026-09-21 at 14.13.20.txt")
  }
}
