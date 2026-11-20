import AtdModel
import Foundation

/// The runs' Live Activities, the focus timer, and putting things right after Atd was closed.
extension AutomationEngine {
  /// How long a finished run stays on the Lock Screen, and an ended focus session (the
  /// prototype's 6 and 5 seconds); the result stays in the app.
  static let finishedLinger: TimeInterval = 6
  static let focusLinger: TimeInterval = 5
  /// A running activity not updated for this long reads as stale: its run stopped somewhere.
  static let staleAfter: TimeInterval = 90

  /// Shows the run in its activity: starts one for a live run that has none, updates it while
  /// the run goes on, and ends it once the run finished or stopped. A step waiting for the person
  /// ranks the activity first and comes with `alert`.
  func present(_ run: AutomationRun, alert: ActivityAlert? = nil) async {
    let state = AutomationActivityAttributes.ContentState(run)
    let activities = environment.activities
    switch run.phase {
    case .finished:
      guard let id = run.activityID else { return }
      let linger = now.addingTimeInterval(Self.finishedLinger)
      await activities.endRun(id, state, dismissal: .after(linger))
    case .interrupted:
      // Left on the Lock Screen, where a tap opens Atd on the automation to continue it.
      guard let id = run.activityID else { return }
      await activities.endRun(id, state, dismissal: .standard)
    case .running, .awaiting:
      let awaiting = state.phase == .awaiting
      let staleDate = awaiting ? nil : now.addingTimeInterval(Self.staleAfter)
      let relevance: Double = awaiting ? 100 : 50
      if let id = run.activityID {
        await activities.updateRun(
          id, state, staleDate: staleDate, relevance: relevance, alert: alert)
      } else if let id = activities.startRun(
        attributes(run), state, staleDate: staleDate, relevance: relevance)
      {
        change(run.id) { run in
          run.activityID = id
          return true
        }
      }
    }
  }

  private func attributes(_ run: AutomationRun) -> AutomationActivityAttributes {
    let automation = book.automation(run.automationID)
    return AutomationActivityAttributes(
      runID: run.id, automationID: run.automationID, name: automation?.name ?? "",
      symbol: automation?.symbol ?? "flowchart", tint: automation?.tint ?? .gray)
  }

  // MARK: Focus

  /// Starts a focus session, or ends the one the automation started: a second tap on the tag
  /// ends it rather than starting over and losing the time.
  func toggleFocus(_ automation: Automation, label: String) async -> TriggerOutcome {
    if let open = log.openSession(of: automation.id), let ended = await endFocus(session: open.id) {
      return .focusEnded(ended)
    }
    var session = FocusSession(automationID: automation.id, label: label, start: now)
    let attributes = FocusActivityAttributes(
      sessionID: session.id, automationID: automation.id, label: label, start: session.start)
    session.activityID = environment.activities.startFocus(attributes, .init())
    let started = session
    write(AutomationLog.self) { $0.record(started) }
    return .focusStarted(started)
  }

  /// Ends a session that is still timing (结束, or the tag tapped again) and shows its time.
  @discardableResult
  public func endFocus(session id: UUID) async -> FocusSession? {
    let end = now
    var ended: FocusSession?
    write(AutomationLog.self) { log in
      guard var session = log.session(id), session.isOpen else { return }
      session.end = end
      log.record(session)
      ended = session
    }
    guard let ended else { return nil }
    if let activity = ended.activityID {
      let linger = end.addingTimeInterval(Self.focusLinger)
      await environment.activities.endFocus(activity, .init(end: end), dismissal: .after(linger))
    }
    return ended
  }

  // MARK: Reconciling

  /// Puts the files right with what is really going on: a run marked running that no task
  /// performs stopped when Atd was closed, so it waits for 继续; a focus session whose activity
  /// went away (the 8-hour limit, or dismissed) is lost, since when it ended is unknown. Runs
  /// waiting for the person keep waiting; a new trigger replaces them.
  ///
  /// Called while Atd launches, when it comes to the front, and before each trigger.
  public func reconcile() async {
    let activities = environment.activities
    let performing = performing
    let commands = commands
    let now = now
    var stopped: [AutomationRun] = []
    write(AutomationLog.self) { log in
      for var run in log.runs where !performing.contains(run.id) {
        guard case .running(let index) = run.phase,
          run.interrupt(text: StepText.waiting(run.plan[index], commands: commands), at: now)
        else { continue }
        log.record(run)
        stopped.append(run)
      }
      for var session in log.sessions where session.isOpen {
        guard let activity = session.activityID, !activities.isActive(activity) else { continue }
        session.lost = true
        log.record(session)
      }
    }
    for run in stopped {
      await present(run)
    }
  }
}
