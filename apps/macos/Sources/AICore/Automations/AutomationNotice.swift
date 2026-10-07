/// What the service wants the person to hear about an automation while the panel may be hidden
/// (`AutomationNoticeSchema` in packages/agent-contracts/src/automation-notices.ts): a run has a
/// result, needs attention or failed, or the automation was turned off. The shell posts one
/// notification per notice and acknowledges it (``AutomationNoticeFeed``). The automation's name
/// and the summary are user and runtime data, shown as they are and never translated.
public struct AutomationNotice: Decodable, Equatable, Sendable {
  public enum Kind: String, Decodable, Equatable, Sendable {
    /// A run has a result to read.
    case delivered
    /// A run declined actions or skipped questions because nobody was present.
    case needsAttention
    /// A run failed or ran out of time.
    case failed
    /// The service turned the automation off after repeated failures.
    case paused
  }

  /// The most notices the service keeps pending (`MAX_AUTOMATION_NOTICES`), so one read and one
  /// acknowledgement always cover them all.
  public static let maxPending = 50

  public let id: String
  public let kind: Kind
  public let automationId: String
  /// The automation's name when the notice was made.
  public let automationName: String
  /// The task a click on the notification opens.
  public let taskId: String?
  /// The opening of the run's answer, or an error.
  public let summary: String?
  /// `needsAttention`: how many actions or questions were declined.
  public let declined: Int?
  public let createdAt: String

  public init(
    id: String, kind: Kind, automationId: String, automationName: String, taskId: String?,
    summary: String?, declined: Int?, createdAt: String
  ) {
    self.id = id
    self.kind = kind
    self.automationId = automationId
    self.automationName = automationName
    self.taskId = taskId
    self.summary = summary
    self.declined = declined
    self.createdAt = createdAt
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.string(.id, minLength: 1, maxLength: 128, pattern: Self.identifier)
    kind = try container.decode(Kind.self, forKey: .kind)
    automationId = try container.string(
      .automationId, minLength: 1, maxLength: 128, pattern: Self.identifier)
    automationName = try container.string(.automationName, minLength: 1, maxLength: 120)
    taskId = try container.optional(.taskId) {
      try container.string($0, minLength: 1, maxLength: 128, pattern: Self.identifier)
    }
    summary = try container.optional(.summary) { try container.string($0, maxLength: 500) }
    declined = try container.optional(.declined) { try container.integer($0, minimum: 0) }
    createdAt = try container.string(.createdAt)
  }

  /// The contract's `Identifier`, which the bridge's `task.open` shares.
  private static let identifier = "^[a-zA-Z0-9_-]+$"

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id
    case kind
    case automationId
    case automationName
    case taskId
    case summary
    case declined
    case createdAt
  }
}

/// `GET /v1/automation-notices` (`AutomationNoticesResponseSchema`): the notices nobody has
/// acknowledged yet, oldest first.
public struct AutomationNoticesResponse: Decodable, Equatable, Sendable {
  public let notices: [AutomationNotice]

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    notices = try container.array(
      .notices, of: AutomationNotice.self, maxItems: AutomationNotice.maxPending)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case notices
  }
}
