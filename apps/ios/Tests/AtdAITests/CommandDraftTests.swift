import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct CommandDraftTests {
  @Test func theSentenceIsThePersonsTurn() {
    let request = CommandDraft.request("把会议记录整理成待办")
    #expect(request.messages == [ModelMessage(.user, "把会议记录整理成待办")])
    #expect(request.system.contains("JSON"))
  }

  @Test func anAnswerInACodeFenceBecomesAKeyboardCommand() throws {
    let answer = """
      Here it is:
      ```json
      {"name": "请假条", "symbol": "doc.text", "tint": "blue",
       "instructions": "按我给的日期和原因写一张请假条。", "input": "text", "output": "insert",
       "review": false,
       "options": [{"label": "语气", "choices": ["正式", "随意", "正式"], "value": "随意"},
                   {"label": "长度", "choices": ["短"], "value": "短"}]}
      ```
      """
    let command = try #require(CommandDraft.command(from: answer, id: "leave"))
    #expect(command.id == "leave")
    #expect(command.name == "请假条")
    #expect(command.tint == .blue)
    #expect(command.output == CommandOutput(action: .insert, review: false))
    #expect(command.placement == CommandPlacement(keyboard: true))
    // The option with a single choice is dropped, and repeated choices are kept once.
    #expect(
      command.options == [
        CommandOption(key: "option1", label: "语气", choices: ["正式", "随意"], value: "随意")
      ])
    #expect(command.versionOption == "option1")
    #expect(command.adjustments == BuiltinCommands.adjustments())
  }

  @Test func valuesThisBuildCannotRunFallBack() throws {
    let answer = """
      {"name": "Summary", "tint": "sparkly", "instructions": "Summarize it.", "input": "image",
       "output": "card", "options": [{"label": "Length", "choices": ["Short", "Long"],
       "value": "Medium"}]}
      """
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.tint == .purple)
    #expect(command.symbol == "sparkles")
    #expect(command.input == .text)
    #expect(command.output == CommandOutput(action: .replace, review: true))
    #expect(command.options.first?.value == "Short")
  }

  @Test func withoutInputTheResultIsInserted() throws {
    let answer = #"{"name": "Joke", "instructions": "Tell a joke.", "input": "none"}"#
    let command = try #require(CommandDraft.command(from: answer))
    #expect(command.input == CommandInput.none)
    #expect(command.output.action == .insert)
  }

  @Test(arguments: [
    "Sorry, I can't help with that.",
    #"{"name": "", "instructions": "Do it."}"#,
    #"{"name": "Name only"}"#,
    #"{"name": "Bad", "instructions": "x", "review": "yes"}"#,
  ])
  func anAnswerThatIsNotACommandIsRejected(_ answer: String) {
    #expect(CommandDraft.command(from: answer) == nil)
  }
}
