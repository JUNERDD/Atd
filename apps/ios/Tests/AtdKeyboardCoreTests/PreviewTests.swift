import AtdAI
import AtdModel
import Foundation
import Testing

@testable import AtdKeyboardCore

/// IME.md: results preview in the host field as marked text, the strip lists the versions with
/// 原文 first, each a choice of the command's option, and every refinement appends a version.
@MainActor
@Suite struct PreviewTests {
  @Test(arguments: [("polish", "tone"), ("translate", "to"), ("shorten", "target")])
  func aResultPreviewsInTheFieldWithTheOriginalFirst(id: String, key: String) async throws {
    let harness = try Harness(FakeDocument("去 不过可能晚点到"))
    harness.generator.reply(.text(["会去的！", "可能晚点到～"]))
    let command = harness.command(id)
    harness.session.run(command)
    await harness.streamed()

    #expect(harness.document.before.isEmpty)
    #expect(harness.document.marked == "会去的！可能晚点到～")
    let preview = try #require(harness.session.strip.preview)
    let option = try #require(command.option(key))
    let choices = [option.value] + option.choices.filter { $0 != option.value }
    #expect(preview.versions.map(\.label) == [.original] + choices.map(Preview.Label.option))
    #expect(preview.versions[0].text == "去 不过可能晚点到")
    #expect(preview.selected == 1)
    #expect(preview.versions.dropFirst(2).allSatisfy { $0.state == .notStarted })
    // Only the version on show was asked for, on the text it replaces.
    #expect(harness.generator.calls.map(\.request.messages[0].text) == ["去 不过可能晚点到"])
  }

  @Test func otherVersionsAreMadeWhenPickedAndKept() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.text(["随意版"]), .text(["正式版"]))
    let polish = harness.command("polish")
    harness.session.run(polish)
    await harness.streamed()
    harness.session.select(version: 2)
    await harness.streamed()

    let tone = try #require(polish.option("tone"))
    let second = try #require(harness.session.strip.preview?.versions[2])
    #expect(second.recipe?.kind == .command(polish, values: ["tone": tone.choices[0]]))
    #expect(harness.document.marked == "正式版")
    harness.session.select(version: 1)
    #expect(harness.document.marked == "随意版")
    harness.session.select(version: 0)
    #expect(harness.document.marked == "晚点到")
    #expect(harness.generator.calls.count == 2)
  }

  @Test func aReplyOffersStancesWithoutADraftAndTonesWithOne() async throws {
    let harness = try Harness()
    harness.clipboard.copy("周六去露营吗？")
    let reply = harness.command("reply")
    harness.session.run(reply)
    await harness.streamed()
    let stance = try #require(reply.option("stance"))
    #expect(harness.session.strip.preview?.versions.first?.label == .option(stance.value))
    #expect(harness.generator.calls[0].request.messages[0].text == "周六去露营吗？")
    harness.session.revert()

    // The draft is what to say and the copied message what it answers; the reply replaces it.
    harness.document.before = "去，晚点到"
    harness.session.run(reply)
    await harness.streamed()
    let tone = try #require(reply.option("tone"))
    let preview = try #require(harness.session.strip.preview)
    #expect(preview.versions.prefix(2).map(\.label) == [.original, .option(tone.value)])
    #expect(preview.versions[0].text == "去，晚点到")
    #expect(harness.document.before.isEmpty)
    let turn = harness.generator.calls[1].request.messages[0].text
    #expect(turn.contains("周六去露营吗？") && turn.contains("去，晚点到"))
  }

  @Test func aRefinementAppendsAVersionMadeFromTheOneOnShow() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.text(["可能会晚点到"]), .text(["晚到"]))
    let polish = harness.command("polish")
    harness.session.run(polish)
    await harness.streamed()
    harness.session.openAsk()
    let ask = try #require(harness.session.strip.ask)
    #expect(ask.purpose == .refine)
    #expect(ask.suggestions == polish.adjustments.map { .refine($0, typed: false) })
    harness.session.act(ask.suggestions[0])
    await harness.streamed()

    let preview = try #require(harness.session.strip.preview)
    #expect(preview.versions.count == 5)
    #expect(preview.selected == 4)
    #expect(preview.shown.label == .refinement(polish.adjustments[0]))
    #expect(harness.document.marked == "晚到")
    let messages = harness.generator.calls[1].request.messages.map(\.text)
    #expect(messages == ["晚点到", "可能会晚点到", polish.adjustments[0]])
  }

  @Test func aSelectionIsWhatACommandWorksOn() async throws {
    let document = FakeDocument("周六", selection: "可能晚点到", after: "，你们先搭帐篷")
    let harness = try Harness(document)
    harness.generator.reply(.text(["会晚一些到"]))
    harness.session.run(harness.command("polish"))
    await harness.streamed()
    #expect(harness.generator.calls[0].request.messages[0].text == "可能晚点到")
    #expect(document.text == "周六会晚一些到，你们先搭帐篷")
    harness.session.delete()
    #expect(document.text == "周六可能晚点到，你们先搭帐篷")
  }

  @Test func withoutASelectionAllTheSharedTextIsReplaced() async throws {
    let document = FakeDocument("去 不过", after: "可能晚点到")
    let harness = try Harness(document)
    harness.session.run(harness.command("polish"))
    await harness.streamed()
    #expect(harness.generator.calls[0].request.messages[0].text == "去 不过可能晚点到")
    #expect(document.before.isEmpty && document.after.isEmpty && document.marked == "结果")
  }

  @Test func aRequestOnTheFieldMakesOneVersionAfterTheOriginal() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.session.runRequest("说得客气点")
    await harness.streamed()
    let preview = try #require(harness.session.strip.preview)
    #expect(preview.versions.map(\.label) == [.original, .request])
    let request = harness.generator.calls[0].request
    #expect(request.messages[0].text == "晚点到" && request.system.contains("说得客气点"))
  }

  @Test func aFailurePutsTheFieldBackAndOffersRetry() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.failure(.offline), .text(["可能会晚点到"]))
    harness.session.run(harness.command("polish"))
    await harness.streamed()
    #expect(harness.document.text == "晚点到")
    #expect(
      harness.session.strip.tools == Tools(canUndo: false, commands: [], line: .failure(.offline)))

    harness.session.retry()
    await harness.streamed()
    #expect(harness.document.marked == "可能会晚点到")
    #expect(harness.generator.calls.count == 2)
  }

  @Test func aFailureForwardsTheMissingModel() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.failure(.noModel))
    harness.session.run(harness.command("polish"))
    await harness.streamed()
    #expect(harness.session.strip.tools?.line == .noModel)
  }

  @Test func aCommandWithoutReviewWritesItsResultDirectly() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    var polish = harness.command("polish")
    polish.output.review = false
    harness.session.run(polish)
    await harness.streamed()
    #expect(harness.document.before == "结果" && harness.document.marked.isEmpty)
    #expect(harness.session.strip.tools?.canUndo == true)
  }

  @Test func leavingTheFieldDropsThePreviewWithoutWriting() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.generator.send("可能")
    await harness.settle()

    harness.document.documentIdentifier = UUID()
    harness.document.marked = ""
    harness.document.before = "别的输入框"
    harness.session.documentChanged()
    #expect(harness.session.strip.tools != nil)
    harness.generator.send("会晚点到")
    harness.generator.finish()
    await harness.settle()
    #expect(harness.document.text == "别的输入框")
  }

  @Test func aFieldTheHostClearedDropsThePreview() async throws {
    let harness = try Harness(FakeDocument("晚点到"))
    harness.generator.reply(.held)
    harness.session.run(harness.command("polish"))
    harness.generator.send("可能")
    await harness.settle()
    harness.document.marked = ""
    harness.session.documentChanged()
    #expect(harness.session.strip.preview == nil)
  }
}
