import AtdModel
import Foundation
import Testing

@testable import AtdShareUI

/// Which commands the share sheet lists for what was shared, in which order, and what each says
/// it will do.
@MainActor @Suite struct ShareMenuTests {
  private let page = SharedContent.page(
    SharedPage(
      url: URL(string: "https://dushu.example.cn/nov")!, title: "城市读书会",
      text: "2031年3月8日 周六 14:00–16:00 静安图书馆"))
  private let image = SharedContent.image(
    SharedImage(name: nil, image: .init(data: Data(), mediaType: "image/jpeg"), preview: nil))

  private func menu(
    _ content: SharedContent, commands: [Command] = BuiltinCommands.all(),
    now: Date = Local.at(3, 1, 9)
  ) -> ShareMenu {
    ShareMenu(
      commands: commands, content: content, now: now, calendar: Local.calendar,
      locale: Locale(identifier: "en_US"))
  }

  private func ids(_ menu: ShareMenu) -> [String] {
    ([menu.suggested].compactMap(\.self) + menu.others).map(\.command.id)
  }

  /// Every command with the share switch on that takes input is listed; the content only
  /// orders them, the prototype's built-ins for it first.
  @Test func aPageListsTheBuiltinsForPagesFirst() {
    #expect(
      ids(menu(page)) == ["event", "shorten", "translate", "polish", "expense", "whiteboard"])
  }

  @Test func anImageListsWhatReadsImagesFirst() {
    #expect(
      ids(menu(image)) == ["event", "translate", "shorten", "expense", "whiteboard", "polish"])
  }

  /// Shared text with no date in it suggests something other than 提取日程.
  @Test func textWithoutADateSuggestsShortening() {
    let menu = menu(.text("这一段话讲的是城市里的步行和街角。"))
    #expect(ids(menu) == ["shorten", "translate", "polish", "event", "expense", "whiteboard"])
  }

  @Test func aDateAheadIsWhat提取日程Says() {
    let menu = menu(page)
    #expect(menu.suggested?.command.id == BuiltinCommands.eventID)
    #expect(menu.suggested?.subtitle == "Sat, Mar 8")
  }

  @Test func aPastDateStillSuggestsTheEventButIsNotShown() throws {
    let menu = menu(.text("2019年3月8日 我们在静安图书馆见过"))
    let event = try #require(menu.suggested)
    #expect(event.command.id == BuiltinCommands.eventID)
    #expect(event.subtitle == event.command.instructions)
  }

  @Test func translateSaysItsRememberedLanguage() throws {
    var library = CommandLibrary.initial()
    let option = try #require(library.command(BuiltinCommands.translateID)?.options.first)
    library.setValue(option.choices[2], for: option.key, in: BuiltinCommands.translateID)
    let entry = menu(page, commands: library.commands).others.first {
      $0.command.id == BuiltinCommands.translateID
    }
    #expect(entry?.subtitle.contains(option.choices[2]) == true)
  }

  /// The share switch decides, and a command that takes no input never runs on a share.
  @Test func onlyCommandsPlacedInTheShareSheetThatTakeInputAreListed() throws {
    var commands = BuiltinCommands.all()
    let shorten = try #require(commands.firstIndex { $0.id == BuiltinCommands.shortenID })
    commands[shorten].placement.share = false
    var own = commands[shorten]
    own.id = "own"
    own.input = .none
    own.placement.share = true
    let listed = ids(menu(.text("hello"), commands: commands + [own]))
    #expect(!listed.contains(BuiltinCommands.shortenID))
    #expect(!listed.contains("own"))
    #expect(!listed.contains(BuiltinCommands.briefingID))
    #expect(!listed.contains(BuiltinCommands.replyID))
  }

  /// A person's own command that reads images comes after those made for text, on text.
  @Test func ownCommandsAreOrderedByWhatTheyRead() throws {
    var picture = try #require(BuiltinCommands.all().first)
    picture.id = "picture"
    picture.input = .image
    picture.placement.share = true
    var words = picture
    words.id = "words"
    words.input = .text
    let listed = ids(menu(.text("hello"), commands: BuiltinCommands.all() + [picture, words]))
    let index = { (id: String) in listed.firstIndex(of: id) ?? -1 }
    #expect(index("words") < index("picture"))
    #expect(index("polish") < index("words"))
  }

  @Test func nothingToListIsEmpty() {
    #expect(menu(.text("hello"), commands: []).isEmpty)
  }
}
