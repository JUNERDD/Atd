import AtdModel
import Foundation
import Testing

@testable import AtdAutomations

/// A message is never sent by Atd: the run stops there, asks on the Lock Screen, and goes on
/// once the person skips it or leaves the compose sheet, however often the answer arrives.
@Suite struct MessageStepTests {
  private let draft = MessageDraft(
    recipients: [MessageRecipient(name: "妈妈", address: "+8613800000000")], body: "到家了")

  private func fixture() throws -> EngineFixture {
    try EngineFixture([
      EngineFixture.automation(steps: [.message(draft: draft), .ledgerToday])
    ])
  }

  @Test func aMessageStopsTheRunAndAsksWithAnAlert() async throws {
    let fixture = try fixture()
    let outcome = await fixture.trigger()
    let run = try #require(outcome.run)
    #expect(run.phase == .awaiting(step: 0))
    #expect(run.steps[0] == StepRecord(status: .waiting, text: StepText.ask(draft)))
    #expect(fixture.activities.calls == [.startRun(.running), .updateRun(.awaiting, alert: true)])
    #expect(fixture.activities.shown.last?.ask == StepText.ask(draft))
    // Shortcuts hears that the run waits; there is no result to read out yet.
    let reply = AutomationReply(outcome)
    #expect(reply.value == reply.dialog)
  }

  @Test func skippingPassesOnTheMessageOnceAndRunsTheRest() async throws {
    let fixture = try fixture()
    let run = try #require(await fixture.trigger().run)
    await fixture.engine.skip(run: run.id, step: 0, budget: nil)
    let done = try #require(fixture.log.run(run.id))
    #expect(done.phase == .finished)
    #expect(done.steps.map(\.status) == [.skipped, .done])
    #expect(done.steps[0].text == StepText.notSent(draft))

    // The button tapped again, or its intent delivered twice, changes nothing.
    let calls = fixture.activities.calls
    await fixture.engine.skip(run: run.id, step: 0, budget: nil)
    await fixture.engine.finishMessage(run: run.id, step: 0, result: .sent, budget: nil)
    #expect(fixture.log.run(run.id) == done)
    #expect(fixture.activities.calls == calls)
  }

  @Test(arguments: [
    (MessageResult.sent, StepRecord.Status.done), (.cancelled, .skipped), (.failed, .failed),
    (.unavailable, .skipped),
  ])
  func howTheComposeSheetWasLeftIsTheStepsResult(
    _ result: MessageResult, _ status: StepRecord.Status
  ) async throws {
    let fixture = try fixture()
    let run = try #require(await fixture.trigger().run)
    await fixture.engine.finishMessage(run: run.id, step: 0, result: result, budget: nil)
    let done = try #require(fixture.log.run(run.id))
    #expect(done.phase == .finished)
    #expect(done.steps.map(\.status) == [status, .done])
  }

  @Test func aQuestionOnTheLockScreenHoldsTheAutomationUntilItIsDismissed() async throws {
    let fixture = try fixture()
    let first = try #require(await fixture.trigger().run)
    let again = await fixture.trigger()
    guard case .alreadyRunning = again else {
      Issue.record("\(again) started over while the question was on show")
      return
    }

    // Once the person swipes the activity away, the next trigger starts a new run.
    fixture.activities.dismissAll()
    let next = try #require(await fixture.trigger().run)
    #expect(next.id != first.id && next.phase == .awaiting(step: 0))
    #expect(fixture.log.runs.map(\.id) == [next.id])
    #expect(fixture.activities.calls.contains(.endRun(.awaiting, .immediate)))
  }
}
