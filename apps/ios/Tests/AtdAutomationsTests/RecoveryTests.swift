import AtdModel
import Foundation
import Testing

@testable import AtdAutomations

/// Runs that cannot finish now: out of the intent's time, or left running when Atd was closed,
/// wait for 继续; one run of an automation goes at a time; the focus timer outlives its trigger.
@Suite struct RecoveryTests {
  private let start = EngineFixture.start

  @Test func aStepStillRunningWhenTheTimeIsUpWaitsForContinue() async throws {
    let model = ScriptedModel([.open, .text("两点读书，四点散步")])
    let fixture = try EngineFixture(
      [EngineFixture.automation(steps: [.command(id: EngineFixture.planner.id), .ledgerToday])],
      model: model)
    try fixture.add(EngineFixture.planner)
    let first = Task { await fixture.trigger(budget: .seconds(1)) }
    try await EngineFixture.eventually { model.requests.count == 1 }

    // One run of an automation at a time: a second trigger while a step runs is turned away.
    let again = await fixture.trigger()
    guard case .alreadyRunning = again else {
      Issue.record("\(again) ran while the first run was still going")
      return
    }
    let stopped = try #require(await first.value.run)
    #expect(stopped.phase == .interrupted(step: 0))
    #expect(stopped.steps.map(\.status) == [.waiting, .waiting])
    #expect(fixture.activities.calls.last == .endRun(.interrupted, .standard))

    // 继续 runs it again from that step, with a new activity.
    await fixture.engine.resume(run: stopped.id, budget: nil)
    let resumed = try #require(fixture.log.run(stopped.id))
    #expect(resumed.phase == .finished && resumed.steps.map(\.status) == [.done, .done])
    #expect(resumed.activityID == "run-2")
    #expect(model.requests.count == 2)
    #expect(fixture.activities.calls.last == .endRun(.finished, .after(start + 6)))
  }

  @Test func anotherAutomationRunsWhileOneIsStillGoing() async throws {
    let model = ScriptedModel([.open])
    let fixture = try EngineFixture(
      [
        EngineFixture.automation(steps: [.command(id: EngineFixture.planner.id)]),
        EngineFixture.automation("other", steps: [.ledgerToday]),
      ], model: model)
    try fixture.add(EngineFixture.planner)
    let first = Task { await fixture.trigger(budget: .seconds(1)) }
    try await EngineFixture.eventually { model.requests.count == 1 }

    // Each automation has its own run and activity; the second leaves the first running.
    let other = try #require(await fixture.trigger("other").run)
    #expect(other.phase == .finished)
    #expect(fixture.log.latestRun(of: "a")?.phase == .running(step: 0))
    #expect(fixture.activities.calls.filter { $0 == .startRun(.running) }.count == 2)
    _ = await first.value
  }

  @Test func aRunLeftRunningWhenAtdClosedWaitsForContinue() async throws {
    let closed = EngineFixture.automation(steps: [.ledgerToday, .agenda(day: .today)])
    let asking = EngineFixture.automation(
      "asking", steps: [.message(draft: MessageDraft(body: "到家了"))])
    let fixture = try EngineFixture([closed, asking])
    _ = await fixture.trigger("asking")
    let fresh = AutomationRun(automation: closed, source: .shortcuts, at: start) { _ in "" }
    var run = try #require(fresh.after { $0.start(0, text: "正在总结今天的账", at: start) })
    run.activityID = "left-over"
    try fixture.store.update(AutomationLog.self) { [run] in $0.record(run) }

    await fixture.engine.reconcile()
    let stopped = try #require(fixture.log.run(run.id))
    #expect(stopped.phase == .interrupted(step: 0))
    #expect(
      stopped.steps[0]
        == StepRecord(
          status: .waiting, text: StepText.waiting(.ledgerToday, commands: fixture.library)))
    #expect(fixture.activities.calls.last == .endRun(.interrupted, .standard))
    // A run waiting for the person keeps waiting.
    #expect(fixture.log.latestRun(of: "asking")?.phase == .awaiting(step: 0))
  }

  @Test func theFirstTapStartsTheFocusTimerAndTheNextEndsIt() async throws {
    let fixture = try EngineFixture([EngineFixture.desk])
    guard case .focusStarted(let started) = await fixture.trigger("desk") else {
      Issue.record("the first tap did not start a session")
      return
    }
    #expect(started.isOpen && started.activityID == "focus-1")
    fixture.clock.advance(25 * 60 + 12)
    guard case .focusEnded(let ended) = await fixture.trigger("desk") else {
      Issue.record("the second tap did not end the session")
      return
    }
    #expect(ended.id == started.id && ended.duration == .seconds(25 * 60 + 12))
    #expect(fixture.activities.calls == [.startFocus, .endFocus(.after(start + 25 * 60 + 17))])
    let time = FocusTime.text(.seconds(25 * 60 + 12))
    #expect(AutomationReply(.focusEnded(ended)).dialog == StepText.text("reply.focusEnded \(time)"))
    #expect(fixture.log.runs.isEmpty)
  }

  @Test func endingASessionTwiceEndsItOnce() async throws {
    let fixture = try EngineFixture([EngineFixture.desk])
    guard case .focusStarted(let started) = await fixture.trigger("desk") else {
      Issue.record("the tap did not start a session")
      return
    }
    fixture.clock.advance(60)
    let ended = await fixture.engine.endFocus(session: started.id)
    fixture.clock.advance(60)
    #expect(await fixture.engine.endFocus(session: started.id) == nil)
    #expect(ended?.end == start + 60 && fixture.log.session(started.id) == ended)
  }

  @Test func aSessionWhoseActivityWentAwayIsLostAndTheNextTapStartsAnew() async throws {
    let fixture = try EngineFixture([EngineFixture.desk])
    let old = FocusSession(
      automationID: "desk", label: "书桌", start: start - 9 * 3600, activityID: "ended-by-the-system")
    try fixture.store.update(AutomationLog.self) { $0.record(old) }
    guard case .focusStarted(let new) = await fixture.trigger("desk") else {
      Issue.record("the tap ended a session whose end is unknown")
      return
    }
    #expect(new.id != old.id)
    #expect(fixture.log.session(old.id)?.lost == true && fixture.log.session(old.id)?.end == nil)
  }
}
