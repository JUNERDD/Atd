import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct CommandPromptTests {
  private let commands = BuiltinCommands.all()

  private func command(_ id: String) throws -> Command {
    try #require(commands.first { $0.id == id })
  }

  @Test func aCommandSendsItsInstructionsOptionsAndInput() throws {
    let polish = try command(BuiltinCommands.polishID)
    let request = CommandPrompt.request(.command(polish), input: "明天开会改到下午")
    let system = request.system.components(separatedBy: "\n")
    #expect(system.count == 2 + 1 + polish.options.count)
    #expect(system[1].isEmpty)
    #expect(system[2].contains(polish.instructions))
    for (line, option) in zip(system[3...], polish.options) {
      #expect(line.contains(option.label) && line.contains(option.value))
    }
    #expect(request.messages == [ModelMessage(.user, "明天开会改到下午")])
    #expect(request.maxOutputTokens == ModelRequest.defaultMaxOutputTokens)
  }

  @Test func aVersionOverridesOneOption() throws {
    let polish = try command(BuiltinCommands.polishID)
    let tone = try #require(polish.option("tone"))
    let other = try #require(tone.choices.first { $0 != tone.value })
    let version = CommandPrompt.request(.command(polish, values: ["tone": other]), input: "x")
    let remembered = CommandPrompt.request(.command(polish), input: "x")
    let toneLine = { (system: String) in
      system.components(separatedBy: "\n").first { $0.contains(tone.label) }
    }
    #expect(toneLine(version.system)?.contains(other) == true)
    #expect(toneLine(remembered.system)?.contains(tone.value) == true)
    #expect(version.messages == remembered.messages)
  }

  @Test func aDraftSaysWhatTheReplyShouldSay() throws {
    let reply = try command(BuiltinCommands.replyID)
    let plain = CommandPrompt.request(.command(reply), input: "周六一起吃饭吗？")
    let withDraft = CommandPrompt.request(
      .command(reply), input: "周六一起吃饭吗？", draft: "  这周不行，下周可以 \n")
    #expect(plain.messages == [ModelMessage(.user, "周六一起吃饭吗？")])
    let turn = try #require(withDraft.messages.first?.text)
    let message = try #require(turn.range(of: "周六一起吃饭吗？"))
    let draft = try #require(turn.range(of: "这周不行，下周可以"))
    #expect(message.upperBound < draft.lowerBound)
    #expect(!turn.contains("  这周"))
    // One more rule line: follow the draft.
    #expect(
      withDraft.system.components(separatedBy: "\n").count
        == plain.system.components(separatedBy: "\n").count + 1)
    let blankDraft = CommandPrompt.request(.command(reply), input: "周六一起吃饭吗？", draft: " ")
    #expect(blankDraft == plain)
  }

  @Test func aTypedRequestBecomesTheInstructions() {
    let request = CommandPrompt.request(.request("改成英文邮件"), input: "明天请假")
    #expect(request.system.contains("改成英文邮件"))
    #expect(request.messages == [ModelMessage(.user, "明天请假")])
  }

  @Test func withoutInputTheInstructionsAreTheTurn() {
    let request = CommandPrompt.request(.request("写一句生日祝福"), input: "")
    #expect(request.messages == [ModelMessage(.user, "写一句生日祝福")])
    #expect(!request.system.contains("写一句生日祝福"))
  }

  @Test func continuationSendsTheTextBeforeTheCursor() {
    let request = CommandPrompt.request(.continuation, input: "今天的会议主要讨论了")
    #expect(request.messages == [ModelMessage(.user, "今天的会议主要讨论了")])
    #expect(request.system.components(separatedBy: "\n").count == 3)
  }

  @Test func refinementsContinueTheConversation() throws {
    let shorten = try command(BuiltinCommands.shortenID)
    let request = CommandPrompt.request(
      .command(shorten), input: "原文",
      refinements: [
        CommandPrompt.Refinement(result: "第一版", request: "再短点"),
        CommandPrompt.Refinement(result: "第二版", request: "加个表情"),
      ])
    #expect(
      request.messages == [
        ModelMessage(.user, "原文"), ModelMessage(.assistant, "第一版"),
        ModelMessage(.user, "再短点"), ModelMessage(.assistant, "第二版"),
        ModelMessage(.user, "加个表情"),
      ])
    #expect(request.system == CommandPrompt.request(.command(shorten), input: "原文").system)
  }

  @Test func askKeepsEarlierExchangesAndPhotos() {
    let photo = ModelImage(data: Data([0xFF]), mediaType: "image/jpeg")
    let request = AskPrompt.request(
      "那这个呢？", images: [photo],
      after: [AskPrompt.Exchange(question: "这是什么花？", images: [photo], answer: "茉莉")])
    #expect(!request.system.isEmpty)
    #expect(
      request.messages == [
        ModelMessage(.user, "这是什么花？", images: [photo]), ModelMessage(.assistant, "茉莉"),
        ModelMessage(.user, "那这个呢？", images: [photo]),
      ])
  }
}
