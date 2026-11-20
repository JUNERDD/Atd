import AtdModel
import Foundation
import Testing
import UIKit

@testable import AtdAutomations
@testable import AtdWidgetsUI

/// What the files and the activities hold: an activity's data stays within the system's 4 KB,
/// the log keeps what the app shows, and every symbol the automations name exists.
@Suite struct ActivityStateTests {
  private let start = EngineFixture.start

  private func run(of steps: [AutomationStep], text: String) -> AutomationRun {
    AutomationRun(
      automation: EngineFixture.automation(steps: steps), source: .shortcuts, at: start
    ) { _ in text }
  }

  @Test func anActivityHoldsAtMostSixStepsOfFortyEightCharacters() throws {
    let long = String(repeating: "一段很长的步骤说明", count: 20)
    var run = run(of: Array(repeating: .ledgerToday, count: 9), text: long)
    run.phase = .running(step: 7)
    let state = AutomationActivityAttributes.ContentState(run)
    #expect(state.steps.count == 6 && state.steps.allSatisfy { $0.text.count == 48 })
    #expect(state.current == 5)
    let attributes = AutomationActivityAttributes(
      runID: run.id, automationID: UUID().uuidString,
      name: String(repeating: "看明天的日程 + ", count: 6), symbol: "sensor.tag.radiowaves.forward",
      tint: .indigo)
    let size = try JSONEncoder().encode(attributes).count + JSONEncoder().encode(state).count
    // The system allows 4 KB; half a kilobyte stays for its own encoding.
    #expect(size < 3_584, "an activity's data is \(size) bytes")
  }

  @Test func aRunWithoutStepsShowsAsFinished() {
    let state = AutomationActivityAttributes.ContentState(run(of: [], text: ""))
    #expect(state.phase == .finished && state.current == 0 && state.ask == nil)
  }

  @Test func theLogKeepsEachAutomationsLatestRunAndTheLatestSessions() {
    var log = AutomationLog()
    let first = run(of: [.ledgerToday], text: "")
    let second = run(of: [.ledgerToday], text: "")
    log.record(first)
    log.record(second)
    #expect(log.runs.map(\.id) == [second.id])
    for minute in 0..<(AutomationLog.sessionLimit + 5) {
      log.record(
        FocusSession(automationID: "desk", label: "书桌", start: start + Double(minute) * 60))
    }
    #expect(log.sessions.count == AutomationLog.sessionLimit)
    #expect(log.sessions.first?.start == start + Double(AutomationLog.sessionLimit + 4) * 60)
    log.forget("desk")
    log.forget("a")
    #expect(log.sessions.isEmpty && log.runs.isEmpty)
  }

  @Test func aNewBookStartsWithTheFiveBuiltInAutomationsNoneOfThemSetUp() {
    let automations = AutomationBook.initial().automations
    #expect(
      automations.map(\.id).count == 5 && Set(automations.map(\.id)) == BuiltinAutomations.ids)
    #expect(automations.allSatisfy { !$0.isLinked && $0.isEnabled && !$0.steps.isEmpty })
    #expect(automations.first { $0.id == BuiltinAutomations.deskID }?.focusLabel != nil)
    #expect(automations.first { $0.id == BuiltinAutomations.carplayID }?.readsAloud == true)
    // Their words come from the catalog, never its keys.
    let messages = automations.flatMap(\.steps).compactMap { step -> String? in
      if case .message(let draft) = step { draft.body } else { nil }
    }
    let words =
      automations.flatMap { [$0.name, $0.trigger.title] } + automations.compactMap(\.focusLabel)
      + messages
    #expect(messages.count == 1)
    #expect(words.allSatisfy { !$0.isEmpty && !$0.hasPrefix("builtin.") }, "\(words)")
  }

  static let symbols: [String] = {
    let steps: [AutomationStep] = [
      .agenda(day: .today), .ledgerToday, .briefing(day: .today), .command(id: "gone"),
      .message(draft: MessageDraft(body: "")), .focus(label: ""),
    ]
    let statuses: [StepRecord.Status] = [.waiting, .running, .done, .skipped, .failed]
    return TriggerFamily.allCases.map(\.symbol) + BuiltinAutomations.all().map(\.symbol)
      + steps.map { $0.symbol(commands: CommandLibrary(commands: [])) }
      + statuses.map(StepMark.symbol)
  }()

  @Test(arguments: ActivityStateTests.symbols) func theSymbolExists(_ name: String) {
    #expect(UIImage(systemName: name) != nil, "\(name) is not an SF Symbol on this system")
  }
}
