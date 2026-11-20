import AtdAI
import AtdModel
import AtdPinyin
import Testing

@testable import AtdKeyboardCore

/// IME.md: ✦ opens one instruction line that the same keys type into; commands and phrases match
/// by pinyin, and anything else runs as a request of its own (生成).
@MainActor
@Suite struct AskLineTests {
  @Test func theLineTypesWithTheSameKeysAndRunsARequest() async throws {
    let harness = try Harness()
    harness.session.openAsk()
    harness.type("wenyixia")
    #expect(harness.document.text.isEmpty)
    let composing = try #require(harness.session.strip.ask)
    #expect(composing.purpose == .write)
    #expect(composing.letters == "wenyixia" && !composing.candidates.isEmpty)
    #expect(harness.session.keys.returnKey == .confirm)

    harness.session.space()
    let line = try #require(harness.session.strip.ask)
    #expect(line.letters.isEmpty && !line.text.isEmpty)
    #expect(line.suggestions == [.write(line.text)])
    #expect(harness.session.keys.returnKey == .generate(isEnabled: true))

    harness.generator.reply(.text(["要带什么吗？"]))
    harness.session.pressReturn()
    await harness.streamed()
    #expect(harness.session.strip.preview?.versions.map(\.label) == [.request])
    #expect(harness.document.marked == "要带什么吗？")
    // Nothing in the field, so the request itself is what the model is asked.
    #expect(harness.generator.calls.map(\.request.messages[0].text) == [line.text])
  }

  @Test(arguments: [("fy", "translate"), ("rs", "polish"), ("sd", "shorten"), ("suod", "shorten")])
  func commandsAreFoundByTheirPinyin(letters: String, id: String) throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.session.openAsk()
    harness.type(letters)
    let chip = CommandChip(command: harness.command(id), readsFreshCopy: false)
    #expect(harness.session.strip.ask?.hits.first == .command(chip))
  }

  @Test func aReplyIsFoundByTheInitialsOfPartOfItsName() throws {
    let harness = try Harness()
    harness.clipboard.copy("周六去露营吗？")
    harness.session.openAsk()
    harness.type("hf")
    let chip = CommandChip(command: harness.command("reply"), readsFreshCopy: true)
    #expect(harness.session.strip.ask?.hits == [.command(chip)])
  }

  @Test func phrasesAreFoundByTheirPinyin() throws {
    let harness = try Harness()
    harness.session.openAsk()
    harness.type("dz")
    #expect(harness.session.strip.ask?.hits == [.phrase(Harness.phrases[1])])
    harness.session.delete()
    #expect(harness.session.strip.ask?.hits.isEmpty == true)
  }

  @Test func aNameLeadsWithItsCommandAndOtherTextWithARequest() throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.session.openAsk()
    harness.type("fanyi")
    let translate = try #require(harness.session.strip.ask?.candidates.first { $0.text == "翻译" })
    harness.session.pickOnAsk(translate)
    let chip = AskSuggestion.command(
      CommandChip(command: harness.command("translate"), readsFreshCopy: false))
    #expect(harness.session.strip.ask?.suggestions == [chip, .write("翻译")])

    harness.session.type("？")
    #expect(harness.session.strip.ask?.suggestions == [.write("翻译？"), chip])
  }

  @Test func withNothingTypedTheLineOffersTheStripsCommandsOrThePhrases() throws {
    let withText = try Harness(FakeDocument("晚点到"))
    withText.session.openAsk()
    let ids = withText.session.strip.ask?.suggestions.compactMap { suggestion in
      if case .command(let chip) = suggestion { chip.command.id } else { nil }
    }
    #expect(ids == ["polish", "translate", "shorten"])
    #expect(withText.session.strip.ask?.purpose == .rewrite)

    let empty = try Harness()
    empty.session.openAsk()
    #expect(empty.session.strip.ask?.suggestions == Harness.phrases.map(AskSuggestion.phrase))
  }

  @Test func closingTheLineDropsWhatWasTyped() throws {
    let harness = try Harness()
    harness.session.openAsk()
    harness.type("ni")
    harness.session.closeAsk()
    #expect(harness.session.strip.tools != nil && harness.document.text.isEmpty)
    harness.session.openAsk()
    #expect(harness.session.strip.ask?.letters.isEmpty == true)
  }
}

/// IME.md: context ranks the strip. Right after a copy the reply leads; with text, the rewrites.
@MainActor
@Suite struct RankingTests {
  @Test func aFreshCopyPutsItsReplyFirstUntilItIsRead() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    #expect(
      harness.session.strip.tools?.commands.map(\.command.id) == ["polish", "translate", "shorten"])

    harness.clipboard.copy("周六去露营吗？")
    harness.session.refresh()
    let fresh = try #require(harness.session.strip.tools?.commands)
    #expect(fresh.map(\.command.id) == ["reply", "polish", "translate", "shorten"])
    #expect(fresh.map(\.readsFreshCopy) == [true, false, false, false])

    harness.session.run(harness.command("reply"))
    await harness.streamed()
    harness.session.revert()
    #expect(harness.document.text == "晚点到")
    #expect(harness.session.seenChangeCount == harness.clipboard.changeCount)
    let stale = try #require(harness.session.strip.tools?.commands)
    #expect(stale.map(\.command.id) == ["polish", "translate", "shorten", "reply"])
    #expect(stale.allSatisfy { !$0.readsFreshCopy })
  }

  @Test func anEmptyFieldWithNothingCopiedOffersNoCommands() throws {
    let harness = try Harness()
    #expect(harness.session.strip.tools == Tools(canUndo: false, commands: [], line: nil))
  }

  @Test func pastingReadsTheClipboardAndRemembersItForThisRun() throws {
    let harness = try Harness()
    harness.clipboard.copy("明早 9:30 南门集合")
    harness.session.paste()
    #expect(harness.document.before == "明早 9:30 南门集合")
    #expect(harness.clipboard.reads == 1)
    #expect(harness.session.clipboardHistory == ["明早 9:30 南门集合"])
    #expect(harness.session.seenChangeCount == harness.clipboard.changeCount)
  }

  @Test func namesWithoutPinyinMatchTheStartOfAWord() {
    #expect(NameMatching.spells("po", name: "Polish", readings: nil))
    #expect(NameMatching.spells("tr", name: "Quick translate", readings: nil))
    #expect(!NameMatching.spells("p", name: "Polish", readings: nil))
    #expect(!NameMatching.spells("wo", name: "帮我回复", readings: ["bang", "wo", "hui", "fu"]))
  }
}
