import AICore
import Foundation

/// A pending request of the task or one of its subagents, as the card decides it in place
/// (`TaskActivityRequestWire`): an approval, a question, or a view waiting in its own window.
struct TaskActivityPendingRequest: Equatable, Identifiable {
  let id: String
  /// Keeps a stale answer from answering a newer request.
  let revision: Int
  /// The subagent that asked; nil for the task's own request.
  let subagent: String?
  let kind: Kind

  enum Kind: Equatable {
    case approval(TaskActivityApproval)
    case question(TaskActivityQuestion)
    /// A `show_ui` view waits on the person in its window (`ViewOpenParams.callId`); the card
    /// only opens that window or skips the question.
    case view(callID: String, title: String)
  }

  /// The decision Return takes in the row: allowing, or reading a request that needs it first,
  /// or opening the view. A question has none; its field keeps Return for sending.
  var rowDefault: TaskActivityControl? {
    switch kind {
    case .approval(let approval): approval.needsDetail ? .details : .allow
    case .question: nil
    case .view: .openView
    }
  }

  /// The decision Return takes on the request's own page.
  var pageDefault: TaskActivityControl? {
    switch kind {
    case .approval: .allow
    case .question: nil
    case .view: .openView
    }
  }
}

/// What a guarded call would do, with what the conversation's approval shows for it.
struct TaskActivityApproval: Equatable {
  typealias Review = TaskActivityRequestWire.Confirmation.Review

  let scope: TaskActivityGrantWire
  /// The guarded call in full, as far as the service sent it (`detailClipped` past its limit).
  let detail: String
  let clipped: Bool
  let allowlistEntry: String?
  let review: Review?

  /// A row shows one line of the target; longer ones are read on the request's page.
  static let rowTargetLimit = 44

  var isBash: Bool {
    if case .tool(let tool) = scope { return tool.tool == .bash }
    return false
  }

  var access: TaskActivityGrantWire.ComputerAccess? {
    if case .computerAccess(let access) = scope { return access }
    return nil
  }

  /// The row's one line: the access target, or the detail's first line.
  var target: String {
    access?.targetLabel ?? String(detail.prefix { $0 != "\n" })
  }

  /// Read before deciding: the review spoke, access to the computer is granted, or the detail
  /// runs past one line (more lines, more characters than a row shows, or cut by the service).
  var needsDetail: Bool {
    review != nil || access != nil || detail.contains("\n")
      || detail.count > Self.rowTargetLimit || clipped
  }

  /// The grant broader than Allow once, as the panel offers it: a bash command's suggested
  /// allowlist entry, or the tool for the session. Bash without an entry, MCP and computer
  /// access have none, since the service would narrow a session grant to this call.
  var broader: TaskActivityControl? {
    if isBash { return allowlistEntry == nil ? nil : .always }
    if access != nil { return nil }
    if case .tool(let tool) = scope, tool.tool == .mcp { return nil }
    return .session
  }
}

/// A question and its suggested answers (at most `TASK_ACTIVITY_MAX_OPTIONS`).
struct TaskActivityQuestion: Equatable {
  let title: String
  let options: [String]

  /// The row answers with the first suggestions; the rest are on the request's page.
  static let rowOptions = 3
  /// A longer question shows its first lines in the row and the rest on its page.
  static let rowTitleLimit = 80
}

/// A control that answers a request, or opens it; the one pressed shows the answer's progress.
enum TaskActivityControl: Hashable {
  case allow
  case always
  case session
  case decline
  case skip
  case reply
  case option(Int)
  case details
  case openView
}

/// An answer the person gave in the card, for the request at the revision they saw.
struct TaskActivityDecision: Equatable {
  let requestID: String
  let revision: Int
  /// What was pressed; it shows the progress while the answer is on its way.
  let control: TaskActivityControl
  let answer: Answer

  enum Answer: Equatable {
    case once
    case session
    /// Adds the entry to the shell allowlist first, then allows this call once.
    case always(entry: String)
    case declined
    case text(String)
    case skipped
  }

  /// The confirm route's answer; an allowlist entry is saved before it, then allows once.
  var reply: ConfirmReply {
    let answer: ConfirmReply.Answer =
      switch self.answer {
      case .once, .always: .once
      case .session: .session
      case .declined: .declined
      case .text(let text): .text(text)
      case .skipped: .skipped
      }
    return ConfirmReply(requestId: requestID, revision: revision, answer: answer)
  }
}

/// An answer on its way: the task's other decisions wait for the service to settle it.
struct TaskActivitySending: Equatable {
  let requestID: String
  let control: TaskActivityControl
}

/// What the card says under a task's requests after an answer did not land.
enum TaskActivityNotice: Equatable {
  /// The request was settled or replaced elsewhere; the next one shows instead.
  case stale
  case failed
  case allowlistFailed
}

/// The request open on the card's page: the task and which of its requests.
struct TaskActivityPage: Equatable {
  let key: TaskActivityRunKey
  var index: Int
}
