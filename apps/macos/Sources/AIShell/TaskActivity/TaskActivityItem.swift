import Foundation

/// A conversation/run pair remains the action identity across reordering and new runs.
struct TaskActivityRunKey: Hashable, Sendable {
  let taskID: String
  let runID: String
}

struct TaskActivityItem: Identifiable, Equatable {
  let key: TaskActivityRunKey
  let conversationTitle: String
  let title: String
  /// Who started the task: the row's own icon and name.
  let source: TaskActivityApplication
  /// The app the run operates once it called the computer tool, shown inside the task's row.
  let computer: TaskActivityApplication?
  let phase: TaskActivityPhase
  /// What the waiting run asks of the person, oldest first: its own requests and its
  /// subagents', as the card decides them in place. Empty while the run does not wait.
  var requests: [TaskActivityPendingRequest]
  /// The run waits because the computer host is locked; nothing in the card can answer that.
  let locked: Bool
  let detail: String
  /// An authorized source is registered; opening the monitor may still load its first frame.
  let canShowPreview: Bool

  var id: TaskActivityRunKey { key }
  /// Only a run that called the computer tool has a target app and a screen to show.
  var usesComputer: Bool { computer != nil }
  var canStop: Bool { phase.canStop }
  var hasWarning: Bool { phase.hasWarning }
  var needsAttention: Bool { phase == .waiting || hasWarning }
  /// The card decides this run's wait in place: its requests, or the locked screen's note. Its
  /// conversation and screen then move to the row's More menu.
  var decidesInPlace: Bool { phase == .waiting && (!requests.isEmpty || locked) }
}

/// Supplied lifecycle facts; presentation never promotes a stop request to a confirmed stop.
enum TaskActivityPhase: Equatable {
  case running
  case waiting
  case disconnected
  case stopping
  case stopPending
  case stopped
  case completed
  case failed

  var isTerminal: Bool { self == .stopped || self == .completed || self == .failed }
  var canStop: Bool {
    self == .running || self == .waiting || self == .disconnected || self == .stopPending
  }
  var hasWarning: Bool { self == .disconnected || self == .stopPending || self == .failed }
  var isExecuting: Bool { self == .running }
}
