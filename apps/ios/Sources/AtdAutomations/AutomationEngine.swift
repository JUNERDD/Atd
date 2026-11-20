import AtdModel
import Foundation

/// What a trigger did.
public enum TriggerOutcome: Sendable, Equatable {
  /// The run went as far as it can now: finished, waiting for the person, or out of time.
  case ran(Automation, AutomationRun)
  /// The automation is switched off, so nothing ran.
  case disabled(Automation)
  /// Its previous run is still going; one run of an automation at a time.
  case alreadyRunning(Automation)
  case focusStarted(FocusSession)
  case focusEnded(FocusSession)
  /// No automation has this id: it was deleted in Atd while Shortcuts still runs it.
  case missing
}

/// How the person answered a message step in the system's compose sheet.
public enum MessageResult: Sendable, Equatable {
  case sent, cancelled, failed
  /// The iPhone cannot send messages now (no SIM or iMessage), so no sheet was offered.
  case unavailable
}

/// Runs automations step by step and keeps their Live Activities current. Every trigger, button
/// and resume in the app's process goes through `shared`, so one run of an automation goes at a
/// time and every change lands in `automation-runs.json` before it is shown.
///
/// The actor gives way while a step runs, so a skip or another automation's trigger can arrive
/// meanwhile: after each wait a run is read again and a result is applied only if the run is
/// still where it was (`RunTransitions`).
public actor AutomationEngine {
  /// The engine of the app's process; nil without the App Group.
  public static let shared: AutomationEngine? = AutomationEnvironment.live().map {
    AutomationEngine(environment: $0)
  }

  /// The time a run may take inside one App Intent, which the system gives about 30 seconds.
  /// A step still running then stops, and the run waits for 继续 in the app.
  public static let intentBudget: Duration = .seconds(25)

  let environment: AutomationEnvironment
  /// The runs this process is performing. Only the app's process runs automations, so a run
  /// marked running that is not here stopped when Atd was closed.
  var performing: Set<UUID> = []

  public init(environment: AutomationEnvironment) {
    self.environment = environment
  }

  // MARK: Triggers

  /// Runs the automation, as far as `budget` allows (nil: as long as it takes).
  ///
  /// A run from Shortcuts (or the DEBUG hook that stands in for it) links the automation and
  /// runs only while it is switched on; a run from the app (试一次) does neither.
  public func trigger(_ id: String, source: RunSource, budget: Duration?) async -> TriggerOutcome {
    let deadline = budget.map { ContinuousClock.now + $0 }
    await reconcile()
    guard let automation = book.automation(id) else { return .missing }
    if source != .app, automation.linkedAt == nil { link(id) }
    if source != .app, !automation.isEnabled { return .disabled(automation) }
    if let label = automation.focusLabel { return await toggleFocus(automation, label: label) }
    if let previous = log.latestRun(of: id) {
      if isBusy(previous) { return .alreadyRunning(automation) }
      if let activity = previous.activityID {
        let state = AutomationActivityAttributes.ContentState(previous)
        await environment.activities.endRun(activity, state, dismissal: .immediate)
      }
    }
    let commands = commands
    let run = AutomationRun(automation: automation, source: source, at: now) {
      StepText.waiting($0, commands: commands)
    }
    write(AutomationLog.self) { $0.record(run) }
    await present(run)
    await advance(run.id, until: deadline)
    return .ran(automation, log.run(run.id) ?? run)
  }

  /// Passes on the step waiting for the person (跳过), and runs the rest.
  public func skip(run runID: UUID, step index: Int, budget: Duration?) async {
    guard let draft = draft(runID, index) else { return }
    await answer(runID, index, .skipped(text: StepText.notSent(draft)), budget: budget)
  }

  /// Records how the person left the compose sheet, and runs the rest.
  public func finishMessage(
    run runID: UUID, step index: Int, result: MessageResult, budget: Duration?
  )
    async
  {
    guard let draft = draft(runID, index) else { return }
    let outcome: StepOutcome =
      switch result {
      case .sent: .done(text: StepText.sent(draft), output: nil)
      case .cancelled: .skipped(text: StepText.notSent(draft))
      case .failed: .failed(text: StepText.sendFailed)
      case .unavailable: .skipped(text: StepText.cannotSend)
      }
    await answer(runID, index, outcome, budget: budget)
  }

  /// Runs an interrupted run again from the step where it stopped (继续), with a new activity.
  public func resume(run runID: UUID, budget: Duration?) async {
    let deadline = budget.map { ContinuousClock.now + $0 }
    guard let resumed = change(runID, { $0.resume(at: now) }) else { return }
    await present(resumed)
    await advance(runID, until: deadline)
  }

  /// The automation's latest run, as stored now.
  public func latestRun(of automationID: String) -> AutomationRun? {
    log.latestRun(of: automationID)
  }

  // MARK: Steps

  /// Takes the run's steps one after another until it finishes, stops for the person, or runs
  /// out of time.
  private func advance(_ runID: UUID, until deadline: ContinuousClock.Instant?) async {
    performing.insert(runID)
    defer { performing.remove(runID) }
    while let run = log.run(runID), case .running(let index) = run.phase {
      let step = run.plan[index]
      if case .message(let draft) = step {
        let ask = StepText.ask(draft)
        guard let waiting = change(runID, { $0.wait(index, ask: ask, at: now) }) else { return }
        let name = book.automation(run.automationID)?.name ?? ""
        await present(waiting, alert: ActivityAlert(title: name, body: ask))
        return
      }
      let commands = commands
      let running = StepText.running(step, commands: commands)
      guard let started = change(runID, { $0.start(index, text: running, at: now) }) else { return }
      await present(started)
      let performer = StepPerformer(environment: environment, asking: run.source == .app)
      let input = started.input(for: index)
      let outcome: StepOutcome
      do {
        outcome = try await within(deadline) { try await performer.perform(step, input: input) }
      } catch {
        // Out of time, or the run was stopped: the step goes back to waiting for 继续.
        let waiting = StepText.waiting(step, commands: commands)
        if let stopped = change(runID, { $0.interrupt(text: waiting, at: now) }) {
          await present(stopped)
        }
        return
      }
      guard let next = change(runID, { $0.finish(index, outcome, at: now) }) else { return }
      await present(next)
    }
  }

  private func answer(_ runID: UUID, _ index: Int, _ outcome: StepOutcome, budget: Duration?) async
  {
    let deadline = budget.map { ContinuousClock.now + $0 }
    guard let next = change(runID, { $0.finish(index, outcome, at: now) }) else { return }
    await present(next)
    await advance(runID, until: deadline)
  }

  /// The message of the run's step at `index`, while the run waits for the person there.
  private func draft(_ runID: UUID, _ index: Int) -> MessageDraft? {
    guard let run = log.run(runID), run.phase == .awaiting(step: index),
      case .message(let draft) = run.plan[index]
    else { return nil }
    return draft
  }

  /// Whether a run still holds its automation: one being performed, or one waiting for the
  /// person while its activity shows the question. Any other run gives way to a new one.
  private func isBusy(_ run: AutomationRun) -> Bool {
    switch run.phase {
    case .running: performing.contains(run.id)
    case .awaiting: run.activityID.map(environment.activities.isActive) ?? false
    case .interrupted, .finished: false
    }
  }

  private func link(_ id: String) {
    let now = now
    write(AutomationBook.self) { book in
      guard var automation = book.automation(id), automation.linkedAt == nil else { return }
      automation.linkedAt = now
      book.upsert(automation)
    }
  }

  // MARK: Files

  var now: Date { environment.now() }
  var book: AutomationBook { environment.store.load(AutomationBook.self).document }
  var log: AutomationLog { environment.store.load(AutomationLog.self).document }
  var commands: CommandLibrary { environment.store.load(CommandLibrary.self).document }

  /// Applies `change` to the stored document. A file that cannot be written leaves the run where
  /// the file says it is, which the next read shows.
  func write<Document: SharedDocument>(_ type: Document.Type, _ change: (inout Document) -> Void) {
    _ = try? environment.store.update(type, change)
  }

  /// Applies `edit` to the stored run and returns it, or nil when the edit did not apply.
  @discardableResult
  func change(_ runID: UUID, _ edit: (inout AutomationRun) -> Bool) -> AutomationRun? {
    var changed: AutomationRun?
    write(AutomationLog.self) { log in
      guard var run = log.run(runID), edit(&run) else { return }
      log.record(run)
      changed = run
    }
    return changed
  }
}

/// Runs `work`, and cancels it with an error once `deadline` passes.
func within<Value: Sendable>(
  _ deadline: ContinuousClock.Instant?, _ work: @escaping @Sendable () async throws -> Value
) async throws -> Value {
  guard let deadline else { return try await work() }
  return try await withThrowingTaskGroup(of: Value.self) { group in
    group.addTask { try await work() }
    group.addTask {
      try await Task.sleep(until: deadline, clock: .continuous)
      throw CancellationError()
    }
    defer { group.cancelAll() }
    guard let first = try await group.next() else { throw CancellationError() }
    return first
  }
}
