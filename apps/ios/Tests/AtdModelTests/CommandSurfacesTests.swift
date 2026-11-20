import Testing

@testable import AtdModel

/// `Command.runs(on:)`: which entry points can run which commands.
@Suite struct CommandSurfacesTests {
  private func make(_ input: CommandInput, _ action: CommandOutput.Action) -> Command {
    Command(
      id: "own", name: "Own", symbol: "sparkles", tint: .purple, instructions: "Do it.",
      input: input, output: CommandOutput(action: action), placement: CommandPlacement())
  }

  @Test(arguments: CommandInput.allCases, CommandOutput.Action.allCases)
  func theKeyboardRunsTextInAndTextOut(input: CommandInput, action: CommandOutput.Action) {
    let readsWhatItCan = [.text, .copied, .none].contains(input)
    let writesIntoTheField = [.replace, .insert].contains(action)
    #expect(make(input, action).runs(on: .keyboard) == (readsWhatItCan && writesIntoTheField))
  }

  @Test(arguments: CommandInput.allCases)
  func shareAndTheCameraNeedSomethingToRead(input: CommandInput) {
    let command = make(input, .card)
    #expect(command.runs(on: .share) == (input != CommandInput.none))
    #expect(command.runs(on: .camera) == (input != CommandInput.none))
  }

  @Test(arguments: CommandInput.allCases, CommandOutput.Action.allCases)
  func controlsAndSiriRunEveryCommand(input: CommandInput, action: CommandOutput.Action) {
    #expect(make(input, action).runs(on: .controls))
    #expect(make(input, action).runs(on: .siri))
  }

  @Test func everyBuiltinIsPlacedOnlyWhereItRuns() {
    for command in BuiltinCommands.all() {
      for surface in Surface.allCases where command.placement[surface] {
        #expect(command.runs(on: surface), "\(command.id) is placed in \(surface)")
      }
    }
  }

  @Test func theCardCommandsStayOutOfTheKeyboard() {
    let cards = BuiltinCommands.all().filter { $0.output.action == .card }
    #expect(
      Set(cards.map(\.id))
        == [
          BuiltinCommands.eventID, BuiltinCommands.expenseID, BuiltinCommands.briefingID,
          BuiltinCommands.whiteboardID,
        ])
    #expect(cards.allSatisfy { !$0.runs(on: .keyboard) })
  }
}
