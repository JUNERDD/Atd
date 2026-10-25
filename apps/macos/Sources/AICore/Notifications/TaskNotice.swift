/// What the service wants the person to hear about a task they started while they may not be
/// looking at it (`TaskNoticeSchema` in packages/agent-contracts/src/task-notices.ts): a question
/// or an approval nobody answered, a run that finished after a while, a run that failed, or a
/// request it already showed that was settled elsewhere. The shell decides from its preferences and the person's presence whether to post a notification,
/// and acknowledges every notice it read (``TaskNoticeFeed``). The title and the preview are user
/// and runtime data, shown as they are and never translated.
public struct TaskNotice: Decodable, Equatable, Identifiable, Sendable {
  public enum Kind: String, Decodable, Equatable, Sendable {
    /// The agent asked a question nobody has answered for a few seconds.
    case needsInput
    /// The agent waits for approval of a guarded action.
    case needsConfirmation
    /// A run that took a while finished.
    case completed
    /// A run failed.
    case failed
    /// A request whose `needs*` notice the shell already read was answered, withdrawn, expired or
    /// cancelled elsewhere: the shell takes back the notification it showed for that request and
    /// never posts one.
    case resolved
  }

  /// The pending request a `needs*` or `resolved` notice is about, which a notification's Reply,
  /// option or Deny answers
  /// (`POST /v1/confirms`); the revision makes a stale answer fail instead of answering a newer
  /// question.
  public struct Request: Decodable, Equatable, Sendable {
    public let id: String
    public let revision: Int

    public init(id: String, revision: Int) {
      self.id = id
      self.revision = revision
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      id = try container.string(.id, minLength: 1, maxLength: 128, pattern: TaskNotice.identifier)
      revision = try container.integer(.revision, minimum: 1)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
      case id
      case revision
    }
  }

  /// The most notices the service keeps pending (`MAX_TASK_NOTICES`), so one read and one
  /// acknowledgement always cover them all.
  public static let maxPending = 50
  /// The most suggested answers a question carries (`MAX_TASK_NOTICE_OPTIONS`).
  public static let maxOptions = 8

  public let id: String
  public let kind: Kind
  public let taskId: String
  /// The task's title when the notice was made; may be empty.
  public let taskTitle: String
  /// Set on `needsInput`, `needsConfirmation` and `resolved`.
  public let request: Request?
  /// The question, the action awaiting approval, the opening of the answer, or the error; shown
  /// only while message previews are on.
  public let preview: String?
  /// A question's suggested answers, runtime text offered as actions only while message previews
  /// are on; empty when the notice has none.
  public let options: [String]
  public let createdAt: String

  public init(
    id: String, kind: Kind, taskId: String, taskTitle: String, request: Request?,
    preview: String?, options: [String] = [], createdAt: String
  ) {
    self.id = id
    self.kind = kind
    self.taskId = taskId
    self.taskTitle = taskTitle
    self.request = request
    self.preview = preview
    self.options = options
    self.createdAt = createdAt
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.string(.id, minLength: 1, maxLength: 128, pattern: Self.identifier)
    kind = try container.decode(Kind.self, forKey: .kind)
    taskId = try container.string(.taskId, minLength: 1, maxLength: 128, pattern: Self.identifier)
    taskTitle = try container.string(.taskTitle, maxLength: 200)
    request = try container.optional(.request) { try container.value($0, Request.self) }
    preview = try container.optional(.preview) { try container.string($0, maxLength: 500) }
    options = try container.optional(.options) { try Self.options(container, $0) } ?? []
    createdAt = try container.string(.createdAt)
  }

  /// At most ``maxOptions`` suggested answers of at most 500 characters each.
  private static func options(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys)
    throws -> [String]
  {
    let options = try container.array(key, of: String.self, maxItems: maxOptions)
    guard options.allSatisfy({ $0.unicodeScalars.count <= 500 }) else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: container, debugDescription: "options must have at most 500 characters.")
    }
    return options
  }

  /// The contract's `Identifier`.
  static let identifier = "^[a-zA-Z0-9_-]+$"

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id
    case kind
    case taskId
    case taskTitle
    case request
    case preview
    case options
    case createdAt
  }
}

/// `GET /v1/task-notices` (`TaskNoticesResponseSchema`): the notices nobody has acknowledged yet,
/// oldest first.
public struct TaskNoticesResponse: Decodable, Equatable, Sendable {
  public let notices: [TaskNotice]

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    notices = try container.array(.notices, of: TaskNotice.self, maxItems: TaskNotice.maxPending)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case notices
  }
}

/// `POST /v1/confirms` (`ConfirmReplyRequestSchema`): an answer to a pending request
/// (`PermissionAnswerSchema`). A notification answers a question or refuses an action, and never
/// approves; the activity card, which shows the request in full, also approves and skips.
public struct ConfirmReply: Encodable, Equatable, Sendable {
  public enum Answer: Equatable, Sendable {
    /// `{ answer }`: the text typed into a question's Reply field, or the full text of the
    /// suggested answer the person chose.
    case text(String)
    /// `{ decision: 'declined' }`.
    case declined
    /// `{ decision: 'once' }`: allows this call only.
    case once
    /// `{ decision: 'session' }`: allows the tool for the rest of the task's session.
    case session
    /// `{ skipped: true }`: leaves a question unanswered.
    case skipped
  }

  public let requestId: String
  public let revision: Int
  public let answer: Answer

  public init(requestId: String, revision: Int, answer: Answer) {
    self.requestId = requestId
    self.revision = revision
    self.answer = answer
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(requestId, forKey: .requestId)
    try container.encode(revision, forKey: .revision)
    var answer = container.nestedContainer(keyedBy: AnswerKeys.self, forKey: .answer)
    switch self.answer {
    case .text(let text): try answer.encode(text, forKey: .answer)
    case .declined: try answer.encode("declined", forKey: .decision)
    case .once: try answer.encode("once", forKey: .decision)
    case .session: try answer.encode("session", forKey: .decision)
    case .skipped: try answer.encode(true, forKey: .skipped)
    }
  }

  private enum CodingKeys: String, CodingKey {
    case requestId
    case revision
    case answer
  }

  private enum AnswerKeys: String, CodingKey {
    case answer
    case decision
    case skipped
  }
}
