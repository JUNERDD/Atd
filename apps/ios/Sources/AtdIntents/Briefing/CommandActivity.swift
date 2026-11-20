import ActivityKit
import AtdAI
import AtdActions
import AtdModel
import Foundation

/// Runs a command that reads nothing in a Live Activity, without unlocking: its progress, then
/// its result, expanded in the Dynamic Island for a few seconds (the prototype's island) and on
/// the Lock Screen for a while after.
public enum CommandActivity {
  /// How long the result stays before the activity ends (prototype note: about 5 s).
  static let hold: Duration = .seconds(5)
  /// The system stops an intent after about 30 s; the run and the hold stay inside this.
  static let budget: Duration = .seconds(27)
  /// The model's share of the budget.
  static let deadline: Duration = .seconds(20)

  /// Whether the person allows Atd's Live Activities; with them off a run shows in the app (A26).
  public static var isAvailable: Bool {
    ActivityAuthorizationInfo().areActivitiesEnabled
  }

  /// Runs `command` in a new activity, which replaces any earlier one; a second press while the
  /// same command is still working changes nothing.
  /// - Returns: false when ActivityKit refused the activity, so the caller shows the run in the
  ///   app instead.
  ///
  /// Activities are not `Sendable`, so the work with them stays off every actor, where
  /// ActivityKit's own methods run.
  @concurrent
  public static func run(_ command: Command, context: EntryContext) async -> Bool {
    let activities = Activity<BriefingActivityAttributes>.activities
    let working = activities.contains {
      $0.attributes.commandID == command.id && $0.content.state.phase == .working
        && $0.activityState == .active
    }
    if working { return true }
    for activity in activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    let started = ContinuousClock.now
    let now = Date.now
    let content = ActivityContent(
      state: BriefingActivityAttributes.ContentState(phase: .working),
      staleDate: now.addingTimeInterval(45), relevanceScore: 100)
    guard
      let activity = try? Activity.request(
        attributes: BriefingActivityAttributes(command: command, day: now), content: content,
        pushType: nil, style: .standard)
    else { return false }
    let state = await outcome(of: command, context: context)
    await finish(activity, state: state, started: started)
    return true
  }

  /// Ends the activities a run left working when its process was stopped: those still working
  /// that started before `launch`. A run this process starts meanwhile is left alone.
  @concurrent
  public static func endOrphans(startedBefore launch: Date) async {
    for activity in Activity<BriefingActivityAttributes>.activities
    where activity.content.state.phase == .working && activity.attributes.day < launch {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  /// What the run comes to, as the activity shows it.
  static func outcome(of command: Command, context: EntryContext) async
    -> BriefingActivityAttributes.ContentState
  {
    if command.id == BuiltinCommands.briefingID, CommandRun.briefingNeedsAsking(context.reader) {
      return .init(phase: .needsAccess)
    }
    do {
      let card = try await within(deadline) {
        try await CommandRun(context).card(command, asking: false)
      }
      return .init(phase: .done, lines: CardText.lines(card))
    } catch ModelFailure.noModel {
      return .init(phase: .noModel)
    } catch let failure as ModelFailure {
      return .init(phase: .failed, message: failure.message, canRetry: failure.canRetry)
    } catch let failure as CardFailure {
      return .init(phase: .failed, message: failure.message)
    } catch ActionError.denied {
      return .init(phase: .needsAccess)
    } catch {
      // Cancelled by the system, or an error that is not Atd's: the run may be tried again.
      return .init(phase: .failed, message: ModelFailure.timedOut.message, canRetry: true)
    }
  }

  /// Shows the result, expanded once, holds it while the budget allows, then ends the activity
  /// so the Dynamic Island clears while the Lock Screen keeps the result: 15 minutes for an
  /// answer, 5 for a failure.
  @concurrent
  static func finish(
    _ activity: Activity<BriefingActivityAttributes>,
    state: BriefingActivityAttributes.ContentState, started: ContinuousClock.Instant
  ) async {
    let content = ActivityContent(state: state, staleDate: nil, relevanceScore: 100)
    let alert = AlertConfiguration(
      title: "\(activity.attributes.name)", body: "\(state.lines.first ?? state.message ?? "")",
      sound: .default)
    await activity.update(content, alertConfiguration: alert)
    let left = budget - (ContinuousClock.now - started)
    try? await Task.sleep(for: max(min(hold, left), .zero))
    let keep: TimeInterval = state.phase == .done ? 15 * 60 : 5 * 60
    await activity.end(content, dismissalPolicy: .after(.now.addingTimeInterval(keep)))
  }

  /// `work`'s result, or `ModelFailure.timedOut` once `limit` has passed.
  static func within<Value: Sendable>(
    _ limit: Duration, _ work: @escaping @Sendable () async throws -> Value
  ) async throws -> Value {
    try await withThrowingTaskGroup(of: Value.self) { group in
      group.addTask { try await work() }
      group.addTask {
        try await Task.sleep(for: limit)
        throw ModelFailure.timedOut
      }
      defer { group.cancelAll() }
      guard let first = try await group.next() else { throw CancellationError() }
      return first
    }
  }
}
