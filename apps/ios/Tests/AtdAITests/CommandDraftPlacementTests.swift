import AtdModel
import Foundation
import Testing

@testable import AtdAI

/// What a drafted command reads and gives, and where it is placed: card commands, commands for
/// what is shared, and commands without input, as the prototype drafts them.
@Suite struct CommandDraftPlacementTests {
  @Test func theSystemPromptComesFromTheDraftingTable() {
    let system = CommandDraft.request("把会议记录整理成待办").system
    #expect(!system.contains("prompt.draft"))
    #expect(system.contains(#""card""#))
    #expect(system.contains(#""shared""#))
  }

  @Test func aCardDraftShowsItsKindInShareAndSiri() throws {
    let answer = #"""
      {"name": "整理待办", "instructions": "从会议记录里找出所有待办。", "input": "text",
       "output": "card", "card": "notes", "review": false}
      """#
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.input == .text)
    #expect(command.output == CommandOutput(action: .card, review: false, card: .notes))
    #expect(command.placement == CommandPlacement(share: true, siri: true))
  }

  @Test func whatIsSharedShowsOnACard() throws {
    let answer = #"""
      {"name": "Summary", "instructions": "Summarize it.", "input": "shared", "output": "replace"}
      """#
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.input == .shared)
    #expect(command.output == CommandOutput(action: .card, review: true, card: .text))
    #expect(command.placement == CommandPlacement(share: true, siri: true))
  }

  @Test func aDraftWithoutInputGoesToControlsAndSiri() throws {
    let answer = #"""
      {"name": "Break", "instructions": "Suggest a short break.", "input": "none",
       "output": "card", "card": "text"}
      """#
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.input == CommandInput.none)
    #expect(command.output == CommandOutput(action: .card, review: true, card: .text))
    #expect(command.placement == CommandPlacement(controls: true, siri: true))
  }

  @Test(arguments: [
    #""card": "expense""#, #""card": "briefing""#, #""card": "poster""#, "\"x\": 1",
  ])
  func aCardADraftMayNotShowMakesAPlainTextCommand(_ card: String) throws {
    let answer = """
      {"name": "Card", "instructions": "Do it.", "input": "shared", "output": "card", \(card)}
      """
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.input == .text)
    #expect(command.output == CommandOutput(action: .replace, review: true))
    #expect(command.placement == CommandPlacement(keyboard: true))
  }

  @Test(arguments: ["text", "copied", "shared", "none", "image"], ["replace", "insert", "card"])
  func everyDraftIsPlacedOnlyWhereItRuns(input: String, output: String) throws {
    for card in ["text", "notes", "event", "expense"] {
      let answer = """
        {"name": "C", "instructions": "Do it.", "input": "\(input)", "output": "\(output)",
         "card": "\(card)"}
        """
      let command = try #require(CommandDraft.command(from: answer))
      let placed = Surface.allCases.filter { command.placement[$0] }
      #expect(!placed.isEmpty)
      #expect(placed.allSatisfy { command.runs(on: $0) }, "\(input) → \(output), \(card)")
      #expect(command.input != .image)
    }
  }
}
