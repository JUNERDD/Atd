import ActivityKit
import AtdModel
import Foundation

/// What an automation run's Live Activity shows (AtdWidgetsUI draws it): the automation, and as
/// its state the steps with their texts, which the run writes in the app's language.
///
/// The system keeps an activity's data under 4 KB, so the state carries at most `maxSteps` steps
/// with texts of at most `maxText` characters; the views add only their own labels.
public struct AutomationActivityAttributes: ActivityAttributes, Sendable {
  public var runID: UUID
  public var automationID: String
  public var name: String
  /// An SF Symbol name.
  public var symbol: String
  public var tint: CommandTint

  public init(runID: UUID, automationID: String, name: String, symbol: String, tint: CommandTint) {
    self.runID = runID
    self.automationID = automationID
    self.name = name
    self.symbol = symbol
    self.tint = tint
  }

  public static let maxSteps = 6
  public static let maxText = 48

  public struct ContentState: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Sendable {
      case running, awaiting, interrupted, finished
    }

    public struct Step: Codable, Hashable, Sendable {
      public var status: StepRecord.Status
      public var text: String

      public init(status: StepRecord.Status, text: String) {
        self.status = status
        self.text = text
      }
    }

    public var phase: Phase
    /// The step the run is at, from zero: the one running, waiting for the person, or where it
    /// stopped; the last step once finished.
    public var current: Int
    public var steps: [Step]
    /// How many steps could not be done.
    public var failures: Int

    public init(phase: Phase, current: Int, steps: [Step], failures: Int = 0) {
      self.phase = phase
      self.current = current
      self.steps = steps
      self.failures = failures
    }

    /// The run as its activity shows it, cut to what an activity can hold.
    public init(_ run: AutomationRun) {
      switch run.phase {
      case .running: phase = .running
      case .awaiting: phase = .awaiting
      case .interrupted: phase = .interrupted
      case .finished: phase = .finished
      }
      let limit = AutomationActivityAttributes.maxSteps
      current = max(0, min(run.currentStep ?? run.steps.count - 1, limit - 1))
      steps = run.steps.prefix(limit).map {
        Step(status: $0.status, text: String($0.text.prefix(AutomationActivityAttributes.maxText)))
      }
      failures = run.failures
    }

    /// The step the person is asked to approve.
    public var ask: String? {
      phase == .awaiting && steps.indices.contains(current) ? steps[current].text : nil
    }
  }
}

/// What the focus timer's Live Activity shows: the session, and when it ended.
public struct FocusActivityAttributes: ActivityAttributes, Sendable {
  public var sessionID: UUID
  public var automationID: String
  /// What the session is for: 书桌.
  public var label: String
  public var start: Date

  public init(sessionID: UUID, automationID: String, label: String, start: Date) {
    self.sessionID = sessionID
    self.automationID = automationID
    self.label = label
    self.start = start
  }

  public struct ContentState: Codable, Hashable, Sendable {
    /// Nil while it is timing.
    public var end: Date?

    public init(end: Date? = nil) {
      self.end = end
    }
  }
}
