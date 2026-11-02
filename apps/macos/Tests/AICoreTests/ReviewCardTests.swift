import Testing

@testable import AICore

@Suite("Command review draft and actions")
struct ReviewCardTests {
  private var tone: CommandOption {
    .choice(
      .init(
        key: "tone", label: "Tone", value: "formal",
        options: [
          .init(value: "formal", label: "Formal"), .init(value: "casual", label: "Casual"),
        ]))
  }

  @Test("Stages edits in order and undo restores only the most recent change")
  func stagesAndUndoes() throws {
    var draft = ReviewDraft(options: [tone])
    draft.toggle(adjustment: "Shorter")
    draft.choose("casual", for: "tone")
    draft.toggle(adjustment: "Keep names")
    draft.text = "  Keep punctuation \n"
    let adjust = try #require(draft.adjust)
    #expect(adjust.text == "Keep punctuation")
    #expect(adjust.adjustments == ["Shorter", "Keep names"])
    #expect(adjust.arguments?.choices == ["tone": "casual"])
    let removedSuggestion = draft.removeLast()
    #expect(removedSuggestion)
    #expect(draft.choice("tone") == "casual")
    let removedOption = draft.removeLast()
    #expect(removedOption)
    #expect(draft.choice("tone") == "formal")
    #expect(draft.adjust?.arguments == nil)
    draft.clearStaged()
    #expect(draft.text == "  Keep punctuation \n" && draft.canSend)
  }

  @Test("Switching versions retains suggestions and only option changes still different")
  func rebases() {
    var draft = ReviewDraft(options: [tone])
    draft.choose("casual", for: "tone")
    draft.toggle(adjustment: "Shorter")
    draft.rebase([tone.choosing("casual")])
    #expect(draft.items == [.adjustment("Shorter")])
    #expect(draft.choice("tone") == "casual")
    draft.choose("formal", for: "tone")
    draft.rebase([tone.choosing("casual")])
    #expect(draft.changesOptions && draft.choice("tone") == "formal")
    draft.rebase([])
    #expect(draft.items == [.adjustment("Shorter")])
  }

  @Test("Unchanged or invalid choices do not stage a change")
  func noChanges() {
    var draft = ReviewDraft(options: [tone])
    draft.choose("unknown", for: "tone")
    draft.text = " \n "
    #expect(!draft.canSend && draft.adjust == nil)
    draft.choose("casual", for: "tone")
    draft.choose("formal", for: "tone")
    #expect(!draft.canSend)
  }

  @Test("The text limit counts Unicode scalars and never splits a composed character")
  func unicodeLimit() throws {
    var draft = ReviewDraft()
    draft.text = String(repeating: "a", count: ReviewDraft.maxText - 1) + "👨‍👩‍👧‍👦tail"
    let text = try #require(draft.adjust?.text)
    #expect(text == String(repeating: "a", count: ReviewDraft.maxText - 1))
  }

  @Test("Pending reviews stop, completed reviews page, capped reviews cannot regenerate")
  func reviewActions() {
    var state = CommandProgressState()
    func phase(pending: CommandProgressState.Review.Pending? = nil, count: Int = 2)
      -> CommandProgressState.Phase
    {
      .answer(
        command: "Translate", answer: "Hello", note: nil,
        review: .init(
          source: "你好", changes: nil, version: 1, count: count, options: [], summary: nil,
          adjustments: [], pending: pending))
    }
    state.show(target: "target", phase: phase(pending: .adjust))
    #expect(state.press(.regenerate) == nil)
    #expect(state.press(.version, version: 2) == nil)
    #expect(state.press(.stop)?.action == .stop)
    #expect(state.isReviewing && state.takesKeyboard)
    state.show(target: "target", phase: phase())
    #expect(state.press(.stop) == nil)
    #expect(state.press(.version, version: 0) == nil)
    #expect(state.press(.version, version: 2)?.version == 2)
    state.show(target: "target", phase: phase(count: 20))
    #expect(state.press(.regenerate) == nil)
    #expect(state.press(.close)?.action == .close)
    #expect(state.shown == nil)
  }

  @Test("A wrapped footer reserves space instead of covering the answer")
  func wrappedFooter() {
    let regular = IslandMetrics.answerCardHeight(note: 0, answer: 100)
    #expect(IslandMetrics.answerCardHeight(note: 0, answer: 100, footer: 58) == regular + 26)
    #expect(IslandMetrics.answerRoom(note: 0, footer: 58) == IslandMetrics.answerRoom(note: 0) - 26)
    #expect(
      IslandMetrics.answerCardHeight(note: 0, answer: 10_000, footer: 58)
        == IslandMetrics.maxShape.height)
  }
}
