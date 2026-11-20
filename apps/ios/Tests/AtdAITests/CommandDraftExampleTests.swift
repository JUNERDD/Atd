import Testing

@testable import AtdAI

@Suite struct CommandDraftExampleTests {
  @Test func theAnswerFollowsTheSentenceAsAnExample() throws {
    let request = CommandDraft.request("帮我写个请假条", example: "  主管您好：\n明天想请假一天。\n")
    let plain = CommandDraft.request("帮我写个请假条")
    #expect(request.system == plain.system)
    let turn = try #require(request.messages.first)
    #expect(request.messages.count == 1)
    #expect(turn.role == .user)
    #expect(turn.images.isEmpty)
    // The sentence leads, the answer ends the turn as sent, and a line between them says what it is.
    #expect(turn.text.hasPrefix("帮我写个请假条\n\n"))
    #expect(turn.text.hasSuffix("\n主管您好：\n明天想请假一天。"))
    #expect(turn.text.count > "帮我写个请假条\n\n\n主管您好：\n明天想请假一天。".count)
    // The line comes from the module's CommandDraft table, not the raw key.
    #expect(!turn.text.contains("draft.example"))
  }

  @Test(arguments: ["", " \n "])
  func withoutAnAnswerItIsTheOneSentenceRequest(_ example: String) {
    let sentence = "把会议记录整理成待办"
    #expect(CommandDraft.request(sentence, example: example) == CommandDraft.request(sentence))
  }
}
