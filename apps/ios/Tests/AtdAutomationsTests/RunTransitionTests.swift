import AtdModel
import Foundation
import Testing

@testable import AtdAutomations

/// The run's moves apply only where the run is, so intents delivered twice, buttons tapped twice
/// and steps that finish late change nothing.
@Suite struct RunTransitionTests {
  private let start = Date(timeIntervalSince1970: 1_800_000_000)

  private func run(_ steps: [AutomationStep]) -> AutomationRun {
    let automation = Automation(
      id: "a", trigger: AutomationTrigger(family: .arrive, title: "到家时"), name: "到家清单",
      symbol: "house", tint: .orange, steps: steps)
    return AutomationRun(automation: automation, source: .shortcuts, at: start) { _ in "等" }
  }

  private let message = AutomationStep.message(draft: MessageDraft(body: "到家了"))

  @Test func aRunTakesItsStepsInOrderAndFinishes() throws {
    var run = run([.agenda(day: .tomorrow), .ledgerToday])
    #expect(run.phase == .running(step: 0) && run.steps.map(\.status) == [.waiting, .waiting])
    run = try #require(run.after { $0.start(0, text: "正在看", at: start) })
    run = try #require(
      run.after { $0.finish(0, .done(text: "明天 9:30 面试", output: "日程"), at: start) })
    #expect(run.phase == .running(step: 1))
    run = try #require(run.after { $0.start(1, text: "正在总结", at: start) })
    run = try #require(run.after { $0.finish(1, .done(text: "今天 3 笔", output: "账"), at: start) })
    #expect(run.phase == .finished && !run.isLive && run.currentStep == nil)
    #expect(run.result == "日程\n账")
  }

  @Test func aStepCanOnlyBeStartedAndFinishedWhereTheRunIs() throws {
    var run = run([.agenda(day: .today), .ledgerToday])
    #expect(run.after { $0.start(1, text: "x", at: start) } == nil)
    #expect(run.after { $0.finish(0, .done(text: "x", output: nil), at: start) } == nil)
    run = try #require(run.after { $0.start(0, text: "x", at: start) })
    #expect(run.after { $0.start(0, text: "again", at: start) } == nil)
    run = try #require(run.after { $0.finish(0, .failed(text: "不能读日历"), at: start) })
    // A result arriving again for the same step is ignored.
    #expect(run.after { $0.finish(0, .done(text: "late", output: nil), at: start) } == nil)
    #expect(run.steps[0] == StepRecord(status: .failed, text: "不能读日历"))
    #expect(run.failures == 1)
  }

  @Test func aMessageWaitsForThePersonAndIsAnsweredOnce() throws {
    var run = run([message, .ledgerToday])
    run = try #require(run.after { $0.wait(0, ask: "发一条：“到家了”", at: start) })
    #expect(run.phase == .awaiting(step: 0) && run.isLive)
    #expect(run.after { $0.wait(0, ask: "again", at: start) } == nil)
    #expect(run.after { $0.start(0, text: "x", at: start) } == nil)
    run = try #require(run.after { $0.finish(0, .skipped(text: "没发这条信息"), at: start) })
    #expect(run.after { $0.finish(0, .done(text: "已发出", output: nil), at: start) } == nil)
    #expect(run.phase == .running(step: 1))
    #expect(run.steps[0].status == .skipped)
  }

  @Test func anInterruptedRunPicksUpWhereItStopped() throws {
    var run = run([.briefing(day: .today), .ledgerToday])
    run.activityID = "old"
    run = try #require(run.after { $0.start(0, text: "正在写今日简报…", at: start) })
    run = try #require(run.after { $0.interrupt(text: "今日简报", at: start) })
    #expect(run.phase == .interrupted(step: 0) && !run.isLive)
    #expect(run.steps[0] == StepRecord(status: .waiting, text: "今日简报"))
    #expect(run.after { $0.interrupt(text: "x", at: start) } == nil)
    run = try #require(run.after { $0.resume(at: start) })
    #expect(run.phase == .running(step: 0) && run.activityID == nil)
    #expect(run.after { $0.resume(at: start) } == nil)
    #expect(run.after { $0.start(0, text: "正在写", at: start) } != nil)
  }

  @Test func onlyARunningStepCanBeInterrupted() throws {
    var run = run([message])
    run = try #require(run.after { $0.wait(0, ask: "ask", at: start) })
    #expect(run.after { $0.interrupt(text: "x", at: start) } == nil)
    run = try #require(run.after { $0.finish(0, .done(text: "已发出", output: nil), at: start) })
    #expect(run.after { $0.interrupt(text: "x", at: start) } == nil)
    #expect(run.phase == .finished)
  }

  /// A later step works on the latest result before it, never on a failed or skipped step.
  @Test func aStepReadsTheLatestOutputBeforeIt() throws {
    var run = run([.agenda(day: .today), message, .command(id: "translate")])
    run = try #require(run.after { $0.start(0, text: "x", at: start) })
    run = try #require(run.after { $0.finish(0, .done(text: "今天", output: "日程"), at: start) })
    run = try #require(run.after { $0.wait(1, ask: "ask", at: start) })
    run = try #require(run.after { $0.finish(1, .skipped(text: "没发"), at: start) })
    #expect(run.input(for: 2) == "日程")
    #expect(run.input(for: 0) == nil)
  }
}
