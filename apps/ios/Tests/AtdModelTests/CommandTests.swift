import Foundation
import Testing

@testable import AtdModel

@Suite struct CommandTests {
  @Test func builtinsAreFourTextCommandsAndFourCardCommands() {
    let commands = BuiltinCommands.all()
    #expect(
      commands.map(\.id) == [
        "polish", "reply", "translate", "shorten", "event", "expense", "briefing", "whiteboard",
      ])
    #expect(Set(commands.map(\.id)) == BuiltinCommands.ids)
    for command in commands {
      #expect(!command.name.isEmpty && !command.instructions.isEmpty)
      for option in command.options {
        #expect(option.choices.contains(option.value), "\(command.id).\(option.key)")
      }
    }
    let text = commands.prefix(4)
    #expect(text.allSatisfy { $0.versionOption.flatMap($0.option) != nil })
    #expect(text.allSatisfy { $0.output.action != .card && $0.output.cardKind == .text })
    let cards = commands.dropFirst(4)
    #expect(cards.map(\.output.card) == [.event, .expense, .briefing, .notes])
    #expect(cards.allSatisfy { $0.output.action == .card && $0.output.cardKind == $0.output.card })
    #expect(cards.map(\.input) == [.shared, .image, .none, .image])
    #expect(cards.map(\.output.review) == [true, false, false, false])
  }

  /// Consumers name options by these constants; libraries store the strings, so they stay.
  @Test func builtinOptionsUseTheirKeyConstants() {
    typealias Key = BuiltinCommands.OptionKey
    let keys = Dictionary(
      uniqueKeysWithValues: BuiltinCommands.all().map { ($0.id, $0.options.map(\.key)) })
    #expect(keys[BuiltinCommands.polishID] == [Key.tone, Key.length])
    #expect(keys[BuiltinCommands.replyID] == [Key.stance, Key.tone])
    #expect(keys[BuiltinCommands.translateID] == [Key.language])
    #expect(keys[BuiltinCommands.shortenID] == [Key.target])
    #expect(keys[BuiltinCommands.eventID] == [Key.alert])
    #expect(keys[BuiltinCommands.expenseID] == [Key.book])
    #expect(keys[BuiltinCommands.briefingID] == [Key.detail])
    #expect(keys[BuiltinCommands.whiteboardID] == [Key.format])
    #expect(
      [Key.tone, Key.length, Key.stance, Key.language, Key.target, Key.alert, Key.book]
        == ["tone", "length", "stance", "to", "target", "alert", "book"])
    #expect([Key.detail, Key.format] == ["detail", "format"])
    #expect(EventAlert.optionKey == Key.alert && BriefingDetail.optionKey == Key.detail)
    #expect(NotesFormat.optionKey == Key.format)
  }

  /// The places each built-in starts in, as in the prototype; only the text commands are in the
  /// keyboard, which runs nothing else.
  @Test func builtinsStartWhereThePrototypePutsThem() {
    let places = Dictionary(
      uniqueKeysWithValues: BuiltinCommands.all().map { command in
        (command.id, Surface.allCases.filter { command.placement[$0] })
      })
    #expect(places["polish"] == [.keyboard, .share, .siri])
    #expect(places["reply"] == [.keyboard])
    #expect(places["translate"] == [.keyboard, .share, .camera, .siri])
    #expect(places["shorten"] == [.keyboard, .share])
    #expect(places["event"] == [.share, .camera, .siri])
    #expect(places["expense"] == [.share, .camera, .controls, .siri])
    #expect(places["briefing"] == [.controls, .siri])
    #expect(places["whiteboard"] == [.share, .camera])
    #expect(
      CommandLibrary.initial().keyboardCommands.map(\.id)
        == ["polish", "reply", "translate", "shorten"])
  }

  @Test func outputsWrittenBeforeCardsStillRead() throws {
    let old = try JSONDecoder().decode(
      CommandOutput.self, from: Data(#"{"action":"card","review":true}"#.utf8))
    #expect(old == CommandOutput(action: .card))
    #expect(old.card == nil && old.cardKind == .text)
    let replace = try JSONDecoder().decode(
      CommandOutput.self, from: Data(#"{"action":"replace","review":false}"#.utf8))
    #expect(replace.cardKind == .text)
    let event = CommandOutput(action: .card, card: .event)
    let encoded = try JSONEncoder().encode(event)
    #expect(try JSONDecoder().decode(CommandOutput.self, from: encoded) == event)
    #expect(String(decoding: encoded, as: UTF8.self).contains(#""card":"event""#))
  }

  @Test func replyVersionsFollowTheDraft() throws {
    let reply = try #require(BuiltinCommands.all().first { $0.id == BuiltinCommands.replyID })
    #expect(reply.versionAxis(hasDraft: false)?.key == "stance")
    #expect(reply.versionAxis(hasDraft: true)?.key == "tone")
    let polish = try #require(BuiltinCommands.all().first)
    #expect(polish.versionAxis(hasDraft: true)?.key == "tone")
  }

  @Test func setValueKeepsToTheChoices() throws {
    var polish = try #require(BuiltinCommands.all().first)
    let tone = try #require(polish.option("tone"))
    let other = try #require(tone.choices.first { $0 != tone.value })
    polish.setValue(other, for: "tone")
    #expect(polish.values["tone"] == other)
    #expect(polish.revision == 2)
    polish.setValue("not a choice", for: "tone")
    polish.setValue(other, for: "tone")
    polish.setValue(other, for: "missing")
    #expect(polish.values["tone"] == other)
    #expect(polish.revision == 2)
  }

  @Test func libraryRoundTripsThroughJSON() throws {
    var library = CommandLibrary.initial()
    library.upsert(
      Command(
        id: "custom", name: "整理待办", symbol: "checklist", tint: .mint,
        instructions: "按负责人分组", input: .text, output: CommandOutput(action: .card),
        placement: CommandPlacement(keyboard: true, share: true),
        model: .connection(id: "c1", model: "m1")))
    let data = try JSONEncoder().encode(library)
    #expect(try JSONDecoder().decode(CommandLibrary.self, from: data) == library)
    #expect(library.keyboardCommands.last?.id == "custom")
    library.remove("custom")
    #expect(library.command("custom") == nil)
  }

  @Test func libraryRemembersOptionValues() throws {
    var library = CommandLibrary.initial()
    let to = try #require(library.command("translate")?.option("to"))
    let japanese = try #require(to.choices.last)
    library.setValue(japanese, for: "to", in: "translate")
    #expect(library.command("translate")?.values["to"] == japanese)
  }

  @Test func placementSubscriptCoversEverySurface() {
    var placement = CommandPlacement()
    for surface in Surface.allCases {
      placement[surface] = true
      #expect(placement[surface])
    }
    #expect(
      placement
        == CommandPlacement(keyboard: true, share: true, camera: true, controls: true, siri: true))
    #expect(Surface.available == Surface.allCases)
  }

  @Test func settingsKeepADefaultConnection() throws {
    var settings = AppSettings.initial()
    #expect(settings.defaultConnection == nil)
    let url = try #require(URL(string: "https://api.example.com/v1"))
    let first = ProviderConnection(
      id: "a", presetID: "custom", name: "A", api: .openAICompatible, baseURL: url, model: "m")
    let second = ProviderConnection(
      id: "b", presetID: "anthropic", name: "B", api: .anthropic, baseURL: url, model: "n")
    settings.upsert(first)
    settings.upsert(second)
    #expect(settings.defaultConnection?.id == "a")
    settings.defaultConnectionID = "b"
    settings.remove("b")
    #expect(settings.defaultConnectionID == "a")
    settings.remove("a")
    #expect(settings.defaultConnection == nil)
  }
}
