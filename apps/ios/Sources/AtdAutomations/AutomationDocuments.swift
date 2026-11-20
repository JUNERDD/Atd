import AtdModel
import Foundation

/// The person's automations (`automations.json`), which the app edits and the runs read.
public struct AutomationBook: SharedDocument {
  public static let fileName = "automations.json"
  public static let schemaVersion = 1

  public var automations: [Automation]

  public init(automations: [Automation]) {
    self.automations = automations
  }

  public static func initial() -> AutomationBook {
    AutomationBook(automations: BuiltinAutomations.all())
  }

  public func automation(_ id: String) -> Automation? {
    automations.first { $0.id == id }
  }

  /// Replaces the automation with the same id, or appends a new one.
  public mutating func upsert(_ automation: Automation) {
    if let index = automations.firstIndex(where: { $0.id == automation.id }) {
      automations[index] = automation
    } else {
      automations.append(automation)
    }
  }

  public mutating func remove(_ id: String) {
    automations.removeAll { $0.id == id }
  }
}

/// What the automations did (`automation-runs.json`): the latest run of each automation, which
/// its Live Activity and the app show, and the focus sessions. Only the app's process writes it:
/// Shortcuts and the Live Activities' buttons run Atd's intents there.
public struct AutomationLog: SharedDocument {
  public static let fileName = "automation-runs.json"
  public static let schemaVersion = 1
  /// The most focus sessions kept; older ones are dropped.
  public static let sessionLimit = 200

  /// One per automation, the newest first.
  public var runs: [AutomationRun]
  /// The newest first.
  public var sessions: [FocusSession]

  public init(runs: [AutomationRun] = [], sessions: [FocusSession] = []) {
    self.runs = runs
    self.sessions = sessions
  }

  public static func initial() -> AutomationLog {
    AutomationLog()
  }

  public func run(_ id: UUID) -> AutomationRun? {
    runs.first { $0.id == id }
  }

  /// The automation's latest run.
  public func latestRun(of automationID: String) -> AutomationRun? {
    runs.first { $0.automationID == automationID }
  }

  /// Keeps `run` as its automation's latest run, in place of the one before it.
  public mutating func record(_ run: AutomationRun) {
    if let index = runs.firstIndex(where: { $0.id == run.id }) {
      runs[index] = run
    } else {
      runs.removeAll { $0.automationID == run.automationID }
      runs.insert(run, at: 0)
    }
  }

  public func session(_ id: UUID) -> FocusSession? {
    sessions.first { $0.id == id }
  }

  /// The automation's session that is still timing.
  public func openSession(of automationID: String) -> FocusSession? {
    sessions.first { $0.automationID == automationID && $0.isOpen }
  }

  /// Adds a new session, or replaces the one with the same id.
  public mutating func record(_ session: FocusSession) {
    if let index = sessions.firstIndex(where: { $0.id == session.id }) {
      sessions[index] = session
    } else {
      sessions.insert(session, at: 0)
      if sessions.count > Self.sessionLimit {
        sessions.removeLast(sessions.count - Self.sessionLimit)
      }
    }
  }

  /// Forgets everything a removed automation did.
  public mutating func forget(_ automationID: String) {
    runs.removeAll { $0.automationID == automationID }
    sessions.removeAll { $0.automationID == automationID }
  }
}

/// One run of an automation, step by step.
public struct AutomationRun: Codable, Sendable, Identifiable, Equatable, Hashable {
  public var id: UUID
  public var automationID: String
  public var source: RunSource
  public var startedAt: Date
  public var updatedAt: Date
  public var phase: RunPhase
  /// The steps as they were when the run started, so an edit during the run changes nothing.
  public var plan: [AutomationStep]
  /// What became of each step of `plan`.
  public var steps: [StepRecord]
  /// The Live Activity that shows the run; nil while none could start.
  public var activityID: String?
}

/// Who started a run.
public enum RunSource: String, Codable, Sendable {
  /// A Shortcuts personal automation (or Siri) ran Atd's action: the moment happened.
  case shortcuts
  /// 试一次 in the app, which neither links the automation nor needs it switched on.
  case app
  /// A DEBUG launch argument, for checking runs in the simulator.
  case debug
}

/// Where a run is.
public enum RunPhase: Codable, Sendable, Equatable, Hashable {
  /// Performing the step at this index.
  case running(step: Int)
  /// Waiting for the person to approve the step at this index.
  case awaiting(step: Int)
  /// Stopped before the step at this index finished: the time Shortcuts allows ran out, or Atd
  /// was closed. 继续 runs it again from there.
  case interrupted(step: Int)
  /// Every step is done, skipped or failed.
  case finished
}

/// What became of one step.
public struct StepRecord: Codable, Sendable, Equatable, Hashable {
  public enum Status: String, Codable, Sendable {
    case waiting, running, done, skipped, failed
  }

  public var status: Status
  /// What the step's row says now: what it will do, what it is doing, what it found.
  public var text: String
  /// What a later step works on, and the run's result: the agenda, the briefing, a command's
  /// answer.
  public var output: String?

  public init(status: Status, text: String, output: String? = nil) {
    self.status = status
    self.text = text
    self.output = output
  }
}

/// One focus session that an automation timed (开始专注记录).
public struct FocusSession: Codable, Sendable, Identifiable, Equatable, Hashable {
  public var id: UUID
  public var automationID: String
  /// What it was for: 书桌.
  public var label: String
  public var start: Date
  /// When it was ended; nil while it is timing, and for a lost one.
  public var end: Date?
  /// Its Live Activity disappeared before it was ended (the system's 8-hour limit, or the person
  /// dismissed it), so when it really ended is unknown.
  public var lost: Bool
  public var activityID: String?

  public init(
    id: UUID = UUID(), automationID: String, label: String, start: Date, end: Date? = nil,
    lost: Bool = false, activityID: String? = nil
  ) {
    self.id = id
    self.automationID = automationID
    self.label = label
    self.start = start
    self.end = end
    self.lost = lost
    self.activityID = activityID
  }

  public var isOpen: Bool { end == nil && !lost }

  /// How long it ran, once ended.
  public var duration: Duration? {
    end.map { .seconds(max($0.timeIntervalSince(start), 0)) }
  }
}

/// How long a focus session ran, as the app, the Live Activity and Siri say it: 25:12, or
/// 1:05:12 from an hour on.
public enum FocusTime {
  public static func text(_ duration: Duration) -> String {
    duration >= .seconds(3600)
      ? duration.formatted(.time(pattern: .hourMinuteSecond))
      : duration.formatted(.time(pattern: .minuteSecond))
  }
}

/// The App Group's store for the automation files, which posts its own change notification so a
/// run does not wake the keyboard or reload the command library.
public enum AutomationStore {
  /// The App Group's store, or nil where the process has no group (tests, previews).
  public static func live(bundle: Bundle = .main) -> SharedStore? {
    guard let group = AppGroup.current(bundle: bundle), let directory = group.directory() else {
      return nil
    }
    return SharedStore(directory: directory, notificationName: notificationName(group))
  }

  /// Posted after every change to `automations.json` or `automation-runs.json`.
  public static func notificationName(_ group: AppGroup) -> String {
    "\(group.identifier).automations.changed"
  }
}
