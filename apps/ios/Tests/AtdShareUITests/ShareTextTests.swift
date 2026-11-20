import AtdAI
import AtdModel
import Foundation
import Testing

@testable import AtdShareUI

/// What text commands send for a share, how their answers read as lists, and what is copied.
@MainActor @Suite struct ShareTextTests {
  @Test(arguments: [
    ("· 第一点\n· 第二点", ["第一点", "第二点"]),
    ("1. 周六见\n2、带书\n3) 交换旧书", ["周六见", "带书", "交换旧书"]),
    ("- one\n* two\n• three", ["one", "two", "three"]),
  ])
  func markedLinesAreAList(_ answer: String, _ items: [String]) {
    #expect(ShareText.items(in: answer, isList: false) == items)
  }

  @Test func proseIsNoList() {
    #expect(ShareText.items(in: "11月21日周六见。", isList: false) == nil)
    #expect(ShareText.items(in: "第一行\n第二行", isList: false) == nil)
    #expect(ShareText.items(in: "- 只有一行", isList: false) == nil)
  }

  /// 要点 always reads as a list, marked or not; a number that goes on is part of the point.
  @Test func pointsAreAListEvenUnmarked() {
    #expect(
      ShareText.items(in: "3.5 小时的活动\n12:30 签到", isList: true) == [
        "3.5 小时的活动", "12:30 签到",
      ])
  }

  @Test func aListIsCopiedAsPoints() {
    #expect(ShareText.copyText(items: ["周六见", "带书"]) == "· 周六见\n· 带书")
  }

  @Test func notesAreCopiedWithTheirTodos() {
    let notes = NotesCard(
      title: "周五市集筹备", sections: [.init(heading: "摊位", bullets: ["三号摊位", "靠近入口"])],
      todos: [.init(text: "订桌布", owner: "小周"), .init(text: "买胶带")])
    let text = ShareText.copyText(notes)
    let parts = text.components(separatedBy: "\n\n")
    #expect(parts.count == 3)
    #expect(parts[0] == "周五市集筹备")
    #expect(parts[1] == "摊位\n· 三号摊位\n· 靠近入口")
    #expect(parts[2].hasSuffix("\n· \(ShareText.line(notes.todos[0]))\n· 买胶带"))
    #expect(ShareText.line(notes.todos[0]).contains("小周"))
  }

  /// A shared image goes with the person's first turn; a page goes as its title, address and text.
  @Test func requestsCarryWhatWasShared() throws {
    let translate = try #require(CommandLibrary.initial().command(BuiltinCommands.translateID))
    let photo = ModelImage(data: Data([1, 2, 3]), mediaType: "image/jpeg")
    let image = SharedContent.image(SharedImage(name: nil, image: photo, preview: nil))
    let imageRequest = ShareText.request(translate, values: [:], content: image)
    #expect(imageRequest.messages.first?.images == [photo])

    let page = SharedContent.page(
      SharedPage(url: URL(string: "https://dushu.example.cn")!, title: "共读", text: "正文"))
    let pageRequest = ShareText.request(translate, values: [:], content: page)
    #expect(pageRequest.messages.first?.text == "共读\n\nhttps://dushu.example.cn\n\n正文")
  }
}
