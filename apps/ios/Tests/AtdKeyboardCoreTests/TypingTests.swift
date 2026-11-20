import AtdAI
import AtdModel
import AtdPinyin
import Testing

@testable import AtdKeyboardCore

/// Pinyin in the field, and what follows a commit: predictions with ✦ 续写 first until typing
/// pauses (IME.md), the continuation sent only when tapped.
@MainActor
@Suite struct TypingTests {
  @Test func lettersComposeAndSpaceTakesTheFirstCandidate() throws {
    let harness = try Harness()
    harness.type("nihao")
    #expect(harness.document.marked == "ni'hao")
    #expect(harness.session.strip.candidates?.first?.text == "你好")
    #expect(harness.session.keys.returnKey == .confirm)
    harness.session.space()
    #expect(harness.document.before == "你好" && harness.document.marked.isEmpty)
  }

  @Test func aPickedPartStaysMarkedUntilEveryLetterIsRead() throws {
    let harness = try Harness()
    harness.type("nihaoma")
    let nihao = try #require(harness.session.strip.candidates?.first { $0.text == "你好" })
    harness.session.pick(nihao)
    #expect(harness.document.marked == "你好ma")
    harness.session.delete()
    #expect(harness.document.marked == "你好m")
    // With only the pick left, it goes back to its letters.
    harness.session.delete()
    #expect(harness.document.marked == "ni'hao")

    harness.type("ma")
    harness.session.pick(nihao)
    let ma = try #require(harness.session.strip.candidates?.first { $0.text == "吗" })
    harness.session.pick(ma)
    #expect(harness.document.before == "你好吗" && harness.document.marked.isEmpty)
    // A phrase put together from picks is learned as a word.
    let learned = harness.session.pinyin.userDictionary.entries
    #expect(learned.map(\.text) == ["你好吗"])
    #expect(learned.first?.syllables == ["ni", "hao", "ma"])
  }

  @Test func aSentenceTakenWholeIsNotRecorded() throws {
    let harness = try Harness()
    harness.type("wojintianqushangban")
    harness.session.space()
    #expect(harness.document.before == "我今天去上班")
    #expect(harness.session.pinyin.userDictionary.entries.isEmpty)
  }

  @Test func returnCommitsTheLettersAsTyped() throws {
    let harness = try Harness()
    harness.type("atd")
    harness.session.pressReturn()
    #expect(harness.document.before == "atd" && harness.document.marked.isEmpty)
    #expect(harness.session.strip.tools != nil)
  }

  @Test func otherKeysTakeTheFirstCandidateThenWrite() throws {
    let harness = try Harness()
    harness.type("ni")
    harness.session.type("，")
    harness.session.type("A")
    harness.session.space()
    harness.session.type("1")
    #expect(harness.document.before == "你，A 1")
    harness.session.delete()
    #expect(harness.document.before == "你，A ")
  }

  @Test func aCommitBringsPredictionsUntilTypingPauses() async throws {
    let harness = try Harness()
    harness.type("wo")
    harness.session.space()
    #expect(harness.document.before == "我")
    let predictions = try #require(harness.session.strip.predictions)
    #expect(predictions.offersContinuation)
    #expect(predictions.words.contains("们"))
    #expect(harness.generator.calls.isEmpty)

    harness.session.pickPrediction("们")
    #expect(harness.document.before == "我们")
    #expect(harness.session.strip.predictions != nil)
    await harness.session.predictionTimer?.value
    #expect(harness.session.strip.tools != nil)
  }

  @Test func theContinuationIsSentOnlyWhenTapped() async throws {
    let harness = try Harness()
    harness.type("wo")
    harness.session.space()
    #expect(harness.generator.calls.isEmpty)
    harness.generator.reply(.text(["们一起去吧"]))
    harness.session.runContinuation()
    await harness.streamed()
    #expect(harness.generator.calls.map(\.request.messages[0].text) == ["我"])
    #expect(harness.session.strip.preview?.versions.map(\.label) == [.continuation])
    #expect(harness.document.before == "我" && harness.document.marked == "们一起去吧")
    harness.session.space()
    #expect(harness.document.before == "我们一起去吧")
  }

  /// IME.md: with Full Access off, typing, candidates, associations and phrases keep working,
  /// and AI is one line.
  @Test func withoutFullAccessTypingWorksAndAIIsOneLine() async throws {
    let harness = try Harness(FakeDocument("晚点到"), fullAccess: false)
    harness.clipboard.copy("周六去露营吗？")
    harness.session.refresh()
    #expect(
      harness.session.strip.tools == Tools(canUndo: false, commands: [], line: .fullAccessOff))

    harness.type("nihao")
    #expect(harness.session.strip.candidates?.isEmpty == false)
    harness.session.space()
    #expect(harness.document.before == "晚点到你好")
    let predictions = try #require(harness.session.strip.predictions)
    #expect(!predictions.offersContinuation && !predictions.words.isEmpty)

    harness.session.run(harness.command("polish"))
    harness.session.paste()
    harness.session.openAsk()
    harness.type("dl")
    let ask = try #require(harness.session.strip.ask)
    #expect(ask.hits == [.phrase(Harness.phrases[0])])
    harness.session.act(ask.hits[0])
    #expect(harness.document.before == "晚点到你好我到了，在门口等你")
    #expect(harness.clipboard.reads == 0 && harness.generator.calls.isEmpty)
  }

  @Test func withoutAModelTheCommandsGiveWayToOneLine() throws {
    let harness = try Harness(FakeDocument("晚点到"), model: false)
    #expect(harness.session.strip.tools == Tools(canUndo: false, commands: [], line: .noModel))
    harness.session.run(harness.command("polish"))
    #expect(harness.generator.calls.isEmpty)
    harness.type("wo")
    harness.session.space()
    #expect(harness.session.strip.predictions?.offersContinuation == false)
  }
}
