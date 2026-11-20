import Foundation
import Testing

@testable import AtdModel

@Suite struct CommandTests {
  @Test func builtinsAreTheFourKeyboardCommands() {
    let commands = BuiltinCommands.all()
    #expect(commands.map(\.id) == ["polish", "reply", "translate", "shorten"])
    #expect(commands.allSatisfy { $0.placement.keyboard })
    for command in commands {
      #expect(!command.name.isEmpty && !command.instructions.isEmpty)
      for option in command.options {
        #expect(option.choices.contains(option.value), "\(command.id).\(option.key)")
      }
      #expect(command.versionOption.flatMap(command.option) != nil)
    }
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
    #expect(Surface.available == [.keyboard])
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
