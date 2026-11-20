import AtdAI
import AtdModel
import CoreGraphics
import Foundation
import Testing

@Suite struct CameraTranslationTests {
  private let lines = (1...5).map { id in
    CameraTextLine(
      id: id, text: "line \(id)",
      quad: CameraQuad(CGRect(x: 0.1, y: CGFloat(id) * 0.1, width: 0.5, height: 0.05)))
  }

  @Test func requestCarriesTheTargetInstructionsLinesAndPhoto() throws {
    let translate = try #require(
      BuiltinCommands.all().first { $0.id == BuiltinCommands.translateID })
    let image = ModelImage(data: Data([1, 2, 3]), mediaType: "image/jpeg")
    let request = CameraTranslatePrompt.request(
      translate, lines: lines, image: image, target: "中文", currency: "CNY")
    #expect(request.system.contains("中文"))
    #expect(request.system.contains(translate.instructions))
    #expect(request.system.contains("CNY"))
    #expect(request.system.contains("\"lines\""))
    let turn = try #require(request.messages.first)
    #expect(turn.text.contains("[1] line 1"))
    #expect(turn.images == [image])
  }

  @Test func itemsAppearAsTheirObjectsCompleteAcrossChunks() throws {
    var reader = CameraTranslationReader(lineCount: lines.count)
    let answer = """
      {"title":"日文菜单"}
      {"lines":[2,3],"text":"烤鸡串拼盘（5 串）","price":"¥980","approx":"≈46 元"}
      {"lines":[4],"text":"生啤"}
      """
    var seen: [Int] = []
    for chunk in answer.chunked(by: 7) {
      if reader.feed(chunk) { seen.append(reader.translation.items.count) }
    }
    let translation = try reader.finish()
    #expect(translation.title == "日文菜单")
    #expect(translation.items.map(\.text) == ["烤鸡串拼盘（5 串）", "生啤"])
    #expect(translation.items[0].lines == [2, 3])
    #expect(translation.items[0].approx == "≈46 元")
    #expect(translation.items.map(\.id) == [1, 2])
    // The title, then each item, as soon as its object closed.
    #expect(seen == [0, 1, 2])
  }

  @Test func fencesProseArraysAndPrettyPrintingAreReadToo() throws {
    var reader = CameraTranslationReader(lineCount: lines.count)
    reader.feed(
      """
      Here you go:
      ```json
      [{"title": "Sign"},
       {
         "lines": ["1", "2"],
         "text": "Exit {left}",
         "price": 12
       }]
      ```
      """)
    let translation = try reader.finish()
    #expect(translation.title == "Sign")
    #expect(translation.items.first?.text == "Exit {left}")
    #expect(translation.items.first?.lines == [1, 2])
    #expect(translation.items.first?.price == "12")
  }

  @Test func unknownAndAlreadyTakenLinesAreDropped() throws {
    var reader = CameraTranslationReader(lineCount: lines.count)
    reader.feed(#"{"lines":[1,9],"text":"a"}{"lines":[1,2],"text":"b"}{"text":"c"}"#)
    let items = try reader.finish().items
    #expect(items.map(\.lines) == [[1], [2], []])
  }

  @Test func anAnswerWithoutItemsIsUnreadable() {
    var reader = CameraTranslationReader(lineCount: lines.count)
    reader.feed(#"{"title":"Nothing"} sorry, I can't read it"#)
    #expect(throws: ModelFailure.unreadable(detail: "no translated items")) {
      try reader.finish()
    }
  }
}

extension String {
  /// The string in pieces of `size` characters, as a stream might deliver it.
  func chunked(by size: Int) -> [String] {
    stride(from: 0, to: count, by: size).map { start in
      let from = index(startIndex, offsetBy: start)
      let to = index(from, offsetBy: size, limitedBy: endIndex) ?? endIndex
      return String(self[from..<to])
    }
  }
}
