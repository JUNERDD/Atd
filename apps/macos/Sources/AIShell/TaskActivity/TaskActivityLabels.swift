import AICore
import Foundation

/// A language snapshot makes text and its measured card geometry change in the same update.
struct TaskActivityLabels: Equatable {
  private let values: [TaskActivityStringKey: String]
  private let language: ShellLanguage

  static func current() -> TaskActivityLabels {
    let strings = ShellStrings.shared
    return TaskActivityLabels(
      values: Dictionary(
        uniqueKeysWithValues: TaskActivityStringKey.allCases.map {
          ($0, strings.text($0))
        }), language: strings.language)
  }

  func text(_ key: TaskActivityStringKey) -> String { values[key] ?? key.rawValue }

  func format(_ key: TaskActivityStringKey, _ arguments: CVarArg...) -> String {
    String(format: text(key), locale: Locale(identifier: language.rawValue), arguments: arguments)
  }

  func count(_ key: TaskActivityStringKey, _ count: Int) -> String {
    format(key, count)
  }

  func tasks(_ count: Int) -> String {
    count == 1 ? text(.activityOneTask) : self.count(.activityTasks, count)
  }

  func status(_ phase: TaskActivityPhase) -> String {
    let key: TaskActivityStringKey =
      switch phase {
      case .running: .activityRunning
      case .waiting: .activityWaiting
      case .disconnected: .activityDisconnected
      case .stopping: .activityStopping
      case .stopPending: .activityStopPending
      case .stopped: .activityStopped
      case .completed: .activityCompleted
      case .failed: .activityFailed
      }
    return text(key)
  }

  func section(_ kind: TaskActivitySectionKind) -> String {
    switch kind {
    case .attention: text(.activityGroupAttention)
    case .live: text(.activityGroupLive)
    case .ended: text(.activityGroupEnded)
    }
  }

  func primaryTitle(_ item: TaskActivityItem) -> String {
    let key: TaskActivityStringKey =
      switch item.phase {
      case .waiting: .activityHandleTask
      case .completed: .activityViewResult
      case .disconnected, .stopPending, .failed: .activityViewTask
      default: .activityTaskDetails
      }
    return text(key)
  }

  func note(_ phase: TaskActivityPhase) -> String? {
    let key: TaskActivityStringKey? =
      switch phase {
      case .waiting: .activityWaitingNote
      case .disconnected: .activityDisconnectedNote
      case .stopPending: .activityStopPendingNote
      case .stopping: .activityStoppingNote
      case .stopped: .activityStoppedNote
      case .failed: .activityFailedNote
      case .running, .completed: nil
      }
    return key.map(text)
  }

  /// What an approval would allow, in the conversation's words.
  func scope(_ scope: TaskActivityGrantWire) -> String {
    let key: TaskActivityStringKey =
      switch scope {
      case .file(let file):
        switch (file.tool, file.location) {
        case (.read, .inside): .activityScopeReadInside
        case (.read, .outside): .activityScopeReadOutside
        case (.write, .inside): .activityScopeWriteInside
        case (.write, .outside): .activityScopeWriteOutside
        case (.edit, .inside): .activityScopeEditInside
        case (.edit, .outside): .activityScopeEditOutside
        }
      case .tool(let tool):
        switch tool.tool {
        case .bash: .activityScopeBash
        case .command: .activityScopeCommand
        case .mcp: .activityScopeMcp
        case .web: .activityScopeWeb
        case .app: .activityScopeApp
        case .automation: .activityScopeAutomation
        case .computer: .activityScopeComputer
        }
      case .computerAccess: .activityScopeComputerAccess
      }
    return text(key)
  }

  /// A request count beside the stack under the first request.
  func moreRequests(_ count: Int) -> String {
    count == 1 ? text(.activityOneMoreRequest) : self.count(.activityMoreRequests, count)
  }

  /// A pressed decision's label while its answer is on its way.
  func busy(_ control: TaskActivityControl) -> String {
    switch control {
    case .allow, .always, .session: text(.activityBusyAllowing)
    case .decline: text(.activityBusyDeclining)
    case .skip: text(.activityBusySkipping)
    case .reply, .option, .details, .openView: text(.activityBusySending)
    }
  }

  func notice(_ notice: TaskActivityNotice) -> String {
    switch notice {
    case .stale: text(.activityStaleNote)
    case .failed: text(.activityAnswerFailed)
    case .allowlistFailed: text(.activityAllowlistFailed)
    }
  }
}
