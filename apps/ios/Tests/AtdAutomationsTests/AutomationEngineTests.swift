import AtdAI
import AtdModel
import Foundation
import Testing

@testable import AtdAutomations

/// What a trigger runs: which automations run and get linked, what each step does with what the
/// step before it found, and what the run's Live Activity and Shortcuts are told.
@Suite struct AutomationEngineTests {
  private let start = EngineFixture.start
  /// A finished run stays on the Lock Screen for six seconds.
  private let lingers = ActivityDismissal.after(EngineFixture.start.addingTimeInterval(6))

  @Test func shortcutsRunsTheStepsInOrderAndLinksTheAutomation() async throws {
    let fixture = try EngineFixture([
      EngineFixture.automation(steps: [.ledgerToday, .agenda(day: .today)])
    ])
    try fixture.logTwoExpenses()
    let run = try #require(await fixture.trigger().run)
    let spending = StepText.spending(Spending(totals: ["CNY": 68], count: 2))
    let empty = Agenda(day: start, events: [], reminders: [])
    #expect(run.phase == .finished)
    #expect(
      run.steps == [
        StepRecord(status: .done, text: spending, output: spending),
        StepRecord(
          status: .done, text: StepText.agenda(empty, day: .today),
          output: StepText.listing(empty, day: .today)),
      ])
    #expect(fixture.book.automation("a")?.linkedAt == start)
    #expect(fixture.log.latestRun(of: "a") == run)
    #expect(
      fixture.activities.calls == [
        .startRun(.running), .updateRun(.running, alert: false), .updateRun(.running, alert: false),
        .updateRun(.running, alert: false), .endRun(.finished, lingers),
      ])
  }

  @Test func aSwitchedOffAutomationIsLinkedButDoesNotRun() async throws {
    let fixture = try EngineFixture([
      EngineFixture.automation(steps: [.ledgerToday], isEnabled: false)
    ])
    let outcome = await fixture.trigger()
    guard case .disabled = outcome else {
      Issue.record("\(outcome) did not leave the automation alone")
      return
    }
    #expect(fixture.book.automation("a")?.isLinked == true)
    #expect(fixture.log.runs.isEmpty && fixture.activities.calls.isEmpty)
  }

  @Test func tryingItInTheAppNeitherLinksItNorNeedsTheSwitch() async throws {
    let fixture = try EngineFixture([
      EngineFixture.automation(steps: [.ledgerToday], isEnabled: false)
    ])
    let run = try #require(await fixture.trigger(source: .app).run)
    #expect(run.phase == .finished && run.source == .app)
    #expect(fixture.book.automation("a")?.isLinked == false)
  }

  @Test func anAutomationDeletedInAtdIsMissing() async throws {
    let fixture = try EngineFixture([])
    let outcome = await fixture.trigger("gone")
    #expect(outcome == .missing)
    #expect(AutomationReply(outcome).value == StepText.text("reply.missing"))
  }

  @Test func withoutLiveActivitiesTheRunStillFinishes() async throws {
    let fixture = try EngineFixture(
      [EngineFixture.automation(steps: [.ledgerToday])],
      activities: FakeActivities(allowsStart: false))
    let run = try #require(await fixture.trigger().run)
    #expect(run.phase == .finished && run.activityID == nil)
    #expect(fixture.activities.calls.isEmpty)
  }

  @Test func aStepThatFailsIsMarkedAndTheRestStillRun() async throws {
    // No model is set up, so the briefing cannot be written; the ledger is read all the same.
    let fixture = try EngineFixture([
      EngineFixture.automation(steps: [.briefing(day: .today), .ledgerToday])
    ])
    let outcome = await fixture.trigger()
    let run = try #require(outcome.run)
    #expect(run.phase == .finished)
    #expect(run.steps.map(\.status) == [.failed, .done])
    #expect(run.steps[0].text == ModelFailure.noModel.message)
    #expect(fixture.activities.shown.last?.failures == 1)
    let name = "到家清单"
    #expect(AutomationReply(outcome).dialog == StepText.text("reply.finished.failure \(name)"))
  }

  @Test func theBriefingIsReturnedForShortcutsToReadAloud() async throws {
    let model = ScriptedModel([.text(#"{"sentences":["明天 9:30 面试。","下午没有安排。"]}"#)])
    let fixture = try EngineFixture(
      [EngineFixture.automation(steps: [.briefing(day: .tomorrow)])], model: model)
    let outcome = await fixture.trigger()
    let run = try #require(outcome.run)
    let briefing = "明天 9:30 面试。\n下午没有安排。"
    #expect(run.steps == [StepRecord(status: .done, text: "明天 9:30 面试。", output: briefing)])
    #expect(AutomationReply(outcome).value == briefing)
  }

  @Test func aTextCommandWorksOnWhatTheStepBeforeItFound() async throws {
    let events = [
      AgendaEvent(
        title: "读书会", start: start + 3600, end: start + 7200, isAllDay: false,
        location: "静安图书馆")
    ]
    let model = ScriptedModel([.text("  两点出门去读书会\n记得带书  ")])
    let fixture = try EngineFixture(
      [
        EngineFixture.automation(steps: [
          .agenda(day: .today), .command(id: BuiltinCommands.polishID),
        ])
      ], model: model, agenda: FakeAgenda(events: events))
    let run = try #require(await fixture.trigger().run)
    let listing = StepText.listing(
      Agenda(day: start, events: events, reminders: []), day: .today)
    let polish = try #require(fixture.library.command(BuiltinCommands.polishID))
    #expect(model.requests == [CommandPrompt.request(.command(polish), input: listing)])
    #expect(
      run.steps[1]
        == StepRecord(status: .done, text: "两点出门去读书会", output: "两点出门去读书会\n记得带书"))
    #expect(run.result == listing + "\n两点出门去读书会\n记得带书")
  }

  @Test func aTextCommandWithNothingBeforeItFailsWithoutAskingTheModel() async throws {
    let model = ScriptedModel([.text("不该用到")])
    let fixture = try EngineFixture(
      [EngineFixture.automation(steps: [.command(id: BuiltinCommands.polishID), .ledgerToday])],
      model: model)
    let run = try #require(await fixture.trigger().run)
    #expect(run.steps.map(\.status) == [.failed, .done])
    #expect(run.steps[0].text == StepText.nothingToWorkOn)
    #expect(model.requests.isEmpty)
  }

  @Test func aCommandThatReadsNothingGetsNoneOfTheEarlierResults() async throws {
    let model = ScriptedModel([.text("两点读书，四点散步")])
    let fixture = try EngineFixture(
      [EngineFixture.automation(steps: [.ledgerToday, .command(id: EngineFixture.planner.id)])],
      model: model)
    try fixture.add(EngineFixture.planner)
    try fixture.logTwoExpenses()
    let run = try #require(await fixture.trigger().run)
    let planner = try #require(fixture.library.command(EngineFixture.planner.id))
    #expect(model.requests == [CommandPrompt.request(.command(planner), input: "")])
    #expect(run.steps.map(\.status) == [.done, .done])
  }

  @Test func aCommandDeletedFromTheLibraryFailsItsStep() async throws {
    let fixture = try EngineFixture([EngineFixture.automation(steps: [.command(id: "gone")])])
    let run = try #require(await fixture.trigger().run)
    #expect(run.steps == [StepRecord(status: .failed, text: StepText.commandDeleted)])
  }
}
