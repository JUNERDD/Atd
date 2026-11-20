import AtdModel
import Testing

@testable import AtdIntents

struct CommandCatalogTests {
  private let library = CommandLibrary(commands: [
    personCommand("Polish", placement: CommandPlacement(keyboard: true, siri: true)),
    personCommand(
      "Receipt", input: .image, action: .card,
      placement: CommandPlacement(controls: true, siri: true)),
    personCommand("Plan", input: .none, action: .card, placement: CommandPlacement(controls: true)),
    personCommand("Reply", input: .copied, placement: CommandPlacement(keyboard: true)),
  ])

  @Test func siriListsEveryCommandPlacedThereInLibraryOrder() {
    #expect(CommandCatalog.commands(on: .siri, in: library).map(\.name) == ["Polish", "Receipt"])
  }

  /// Controls run every input: a photo command opens the camera, one that reads nothing
  /// runs in a Live Activity.
  @Test func controlsListEveryCommandPlacedThere() {
    #expect(CommandCatalog.commands(on: .controls, in: library).map(\.name) == ["Receipt", "Plan"])
  }

  @Test func matchingIgnoresCaseWidthAndBlankText() {
    let commands = [personCommand("Polish"), personCommand("润色"), personCommand("ＡＢＣ")]
    #expect(CommandCatalog.matching("pol", in: commands).map(\.name) == ["Polish"])
    #expect(CommandCatalog.matching("abc", in: commands).map(\.name) == ["ＡＢＣ"])
    #expect(CommandCatalog.matching("润", in: commands).map(\.name) == ["润色"])
    #expect(CommandCatalog.matching("  ", in: commands).count == 3)
  }
}
