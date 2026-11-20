import AtdAI
import AtdModel
import Testing

@testable import AtdKeyboardCore

/// IME.md: keys become the preview's controls. Space = 用这个, delete = 还原, return sends what
/// is shown, typing on takes the version and keeps writing; after taking, 撤销 leads the strip
/// and the commands stay next to it. While a version streams, space waits for it, return is
/// off, and typing keeps what is shown so far.
@MainActor
@Suite struct PreviewKeyTests {
  private func previewing(_ text: String = "可能会晚点到") async throws -> Harness {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.text([text]))
    harness.session.run(harness.command("polish"))
    await harness.streamed()
    #expect(harness.session.keys.controlsPreview)
    return harness
  }

  @Test func spaceTakesTheResultAndUndoPutsTheOriginalBack() async throws {
    let harness = try await previewing()
    harness.session.space()
    #expect(harness.document.before == "可能会晚点到" && harness.document.marked.isEmpty)
    let tools = try #require(harness.session.strip.tools)
    #expect(tools.canUndo)
    #expect(tools.commands.map(\.command.id) == ["polish", "translate", "shorten"])

    harness.session.undo()
    #expect(harness.document.text == "晚点到")
    #expect(harness.session.strip.tools?.canUndo == false)
  }

  @Test func undoIsGoneOnceTypingGoesOn() async throws {
    let harness = try await previewing()
    harness.session.space()
    harness.session.type("，")
    #expect(harness.session.strip.tools?.canUndo == false)
    harness.session.undo()
    #expect(harness.document.text == "可能会晚点到，")
  }

  @Test func deletePutsTheOriginalBack() async throws {
    let harness = try await previewing()
    harness.session.delete()
    #expect(harness.document.text == "晚点到" && harness.document.marked.isEmpty)
    #expect(harness.session.strip.tools?.canUndo == false)
  }

  @Test func returnSendsWhatIsShown() async throws {
    let harness = try await previewing()
    #expect(harness.session.keys.returnKey == .host(isEnabled: true))
    harness.session.pressReturn()
    #expect(harness.document.sent == ["可能会晚点到"])
    #expect(harness.session.strip.tools?.canUndo == false)
  }

  @Test func typingOnTakesTheResultAndKeepsWriting() async throws {
    let harness = try await previewing()
    harness.session.type("n")
    #expect(harness.document.before == "可能会晚点到" && harness.document.marked == "n")
    #expect(harness.session.strip.candidates != nil)
  }

  @Test func whileStreamingSpaceWaitsAndReturnIsOff() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.generator.send("可能会")
    await harness.settle()
    #expect(harness.document.marked == "可能会")
    #expect(harness.session.keys.returnKey == .host(isEnabled: false))
    harness.session.pressReturn()
    #expect(harness.document.sent.isEmpty)

    harness.session.space()
    #expect(harness.session.strip.preview != nil)
    harness.generator.send("晚点到")
    harness.generator.finish()
    await harness.streamed()
    #expect(harness.document.before == "可能会晚点到" && harness.document.marked.isEmpty)
    #expect(harness.session.strip.tools?.canUndo == true)
  }

  @Test func deleteWhileStreamingStopsTheStream() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.generator.send("可能")
    await harness.settle()
    harness.session.delete()
    #expect(harness.document.text == "晚点到")

    harness.generator.send("会晚点到")
    harness.generator.finish()
    await harness.settle()
    #expect(harness.document.text == "晚点到" && harness.document.marked.isEmpty)
  }

  @Test func lettersWhileStreamingKeepWhatIsShown() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.generator.send("可能会")
    await harness.settle()
    harness.session.type("w")
    #expect(harness.document.before == "可能会" && harness.document.marked == "w")
  }

  @Test func typingBeforeAnythingIsShownKeepsTheOriginal() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.session.type("w")
    #expect(harness.document.before == "晚点到" && harness.document.marked == "w")
  }

  @Test func pickingAVersionWhileAnotherStreamsStopsIt() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held, .text(["正式版"]))
    harness.session.run(harness.command("polish"))
    harness.generator.send("随意")
    await harness.settle()
    harness.session.select(version: 2)
    await harness.streamed()
    let preview = try #require(harness.session.strip.preview)
    #expect(preview.versions[1].state == .notStarted && preview.versions[1].text.isEmpty)
    #expect(harness.document.marked == "正式版")
  }
}
