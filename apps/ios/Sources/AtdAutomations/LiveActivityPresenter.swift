import ActivityKit
import Foundation

/// An alert that lights the screen and plays the system's sound with an update: a step waiting
/// for the person.
public struct ActivityAlert: Sendable, Equatable {
  public var title: String
  public var body: String

  public init(title: String, body: String) {
    self.title = title
    self.body = body
  }
}

/// When an ended activity leaves the Lock Screen.
public enum ActivityDismissal: Sendable, Equatable {
  /// The system's choice, up to four hours, so a tap can still open Atd.
  case standard
  /// At this moment (within four hours).
  case after(Date)
  /// Now: a new run of the same automation replaces it.
  case immediate
}

/// Starts, updates and ends the runs' and the focus timer's Live Activities, by id.
///
/// From the background an activity can start only while a `LiveActivityIntent` performs, which
/// is where Shortcuts and the activities' buttons run Atd; anywhere else it needs Atd in front.
public protocol ActivityPresenting: Sendable {
  /// Starts a run's activity and returns its id, or nil when the system declined (Live
  /// Activities switched off, too many running, Atd not allowed to start one now).
  func startRun(
    _ attributes: AutomationActivityAttributes, _ state: AutomationActivityAttributes.ContentState,
    staleDate: Date?, relevance: Double
  ) -> String?
  func updateRun(
    _ id: String, _ state: AutomationActivityAttributes.ContentState, staleDate: Date?,
    relevance: Double, alert: ActivityAlert?) async
  func endRun(
    _ id: String, _ state: AutomationActivityAttributes.ContentState, dismissal: ActivityDismissal)
    async
  func startFocus(
    _ attributes: FocusActivityAttributes, _ state: FocusActivityAttributes.ContentState
  ) -> String?
  func endFocus(
    _ id: String, _ state: FocusActivityAttributes.ContentState, dismissal: ActivityDismissal)
    async
  /// Whether the activity is still on show: not ended, and not dismissed by the person.
  func isActive(_ id: String) -> Bool
}

/// ActivityKit's activities. `Activity` is a class that is not `Sendable`, so each call looks its
/// activity up by id instead of keeping it.
public struct LiveActivityPresenter: ActivityPresenting {
  public init() {}

  public func startRun(
    _ attributes: AutomationActivityAttributes, _ state: AutomationActivityAttributes.ContentState,
    staleDate: Date?, relevance: Double
  ) -> String? {
    start(
      attributes, ActivityContent(state: state, staleDate: staleDate, relevanceScore: relevance))
  }

  public func updateRun(
    _ id: String, _ state: AutomationActivityAttributes.ContentState, staleDate: Date?,
    relevance: Double, alert: ActivityAlert?
  ) async {
    guard let activity = Self.activity(AutomationActivityAttributes.self, id) else { return }
    let configuration = alert.map {
      AlertConfiguration(title: "\($0.title)", body: "\($0.body)", sound: .default)
    }
    await activity.update(
      ActivityContent(state: state, staleDate: staleDate, relevanceScore: relevance),
      alertConfiguration: configuration)
  }

  public func endRun(
    _ id: String, _ state: AutomationActivityAttributes.ContentState, dismissal: ActivityDismissal
  ) async {
    guard let activity = Self.activity(AutomationActivityAttributes.self, id) else { return }
    await activity.end(
      ActivityContent(state: state, staleDate: nil), dismissalPolicy: Self.policy(dismissal))
  }

  public func startFocus(
    _ attributes: FocusActivityAttributes, _ state: FocusActivityAttributes.ContentState
  ) -> String? {
    start(attributes, ActivityContent(state: state, staleDate: nil, relevanceScore: 60))
  }

  public func endFocus(
    _ id: String, _ state: FocusActivityAttributes.ContentState, dismissal: ActivityDismissal
  ) async {
    guard let activity = Self.activity(FocusActivityAttributes.self, id) else { return }
    await activity.end(
      ActivityContent(state: state, staleDate: nil), dismissalPolicy: Self.policy(dismissal))
  }

  public func isActive(_ id: String) -> Bool {
    let states = [ActivityState.pending, .active, .stale]
    if let run = Self.activity(AutomationActivityAttributes.self, id) {
      return states.contains(run.activityState)
    }
    if let focus = Self.activity(FocusActivityAttributes.self, id) {
      return states.contains(focus.activityState)
    }
    return false
  }

  private func start<Attributes: ActivityAttributes>(
    _ attributes: Attributes, _ content: ActivityContent<Attributes.ContentState>
  ) -> String? {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
    return try? Activity.request(attributes: attributes, content: content, pushType: nil).id
  }

  private static func activity<Attributes: ActivityAttributes>(
    _ type: Attributes.Type, _ id: String
  ) -> Activity<Attributes>? {
    Activity<Attributes>.activities.first { $0.id == id }
  }

  private static func policy(_ dismissal: ActivityDismissal) -> ActivityUIDismissalPolicy {
    switch dismissal {
    case .standard: .default
    case .after(let date): .after(date)
    case .immediate: .immediate
    }
  }
}
