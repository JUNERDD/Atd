import Foundation

/// A system notification the shell posts, worded from the String Catalog in the shell's language
/// around user and runtime data that goes in as written. Made from an ``AutomationNotice`` or a
/// ``TaskNotice`` under the person's preferences (``NotificationPreferences``): runtime text only
/// while message previews are on, the default sound only while sound is on.
public struct SystemNotification: Equatable, Sendable {
  /// The registered category, which decides the actions a notification offers. Every category
  /// has a placeholder body for when the system hides previews.
  public enum Category: String, CaseIterable, Sendable {
    case automation
    /// A finished or failed task, or one whose request cannot be answered from here.
    case task
    /// A question: offers Reply, a text field whose answer goes to the request. A question with
    /// suggested answers also offers each of them, under a category of its own request
    /// (``categoryIdentifier``).
    case taskNeedsInput = "task.needsInput"
    /// An approval: offers Deny only; approving needs the panel, where the action shows in full.
    case taskNeedsConfirmation = "task.needsConfirmation"
  }

  /// Posting with the same identifier replaces the notification: an automation notice's id, or
  /// one per task (``taskIdentifier(_:)``), so a task's newer state replaces its older one.
  public let identifier: String
  public let title: String
  public let body: String
  /// Notification Center groups by it: the automation's id, or the task's.
  public let threadIdentifier: String
  public let category: Category
  /// The task a click opens.
  public let taskId: String?
  /// The request a Reply, an option or Deny answers.
  public let request: TaskNotice.Request?
  /// A question's suggested answers in full, each offered as an action that answers with it:
  /// only on a question that names its request while previews are on, so no runtime text reaches
  /// a button otherwise.
  public let options: [String]
  /// How the system's notification summary ranks it (`relevanceScore`, 0…1): work waiting on the
  /// person first, then failures, automation results, and finished tasks.
  public let relevance: Double
  /// Play the default sound.
  public let sound: Bool

  public init(
    identifier: String, title: String, body: String, threadIdentifier: String,
    category: Category, taskId: String?, request: TaskNotice.Request?, options: [String] = [],
    relevance: Double, sound: Bool
  ) {
    self.identifier = identifier
    self.title = title
    self.body = body
    self.threadIdentifier = threadIdentifier
    self.category = category
    self.taskId = taskId
    self.request = request
    self.options = category == .taskNeedsInput && request != nil ? options : []
    self.relevance = relevance
    self.sound = sound
  }

  /// The one notification identifier a task's notices share.
  public static func taskIdentifier(_ taskId: String) -> String { "task.\(taskId)" }

  /// The category the notification is posted under: its ``category``, or for a question with
  /// options one registered for that request and revision alone, whose actions are its options.
  public var categoryIdentifier: String {
    guard !options.isEmpty, let request else { return category.rawValue }
    return "\(Category.taskNeedsInput.rawValue).\(request.id).\(request.revision)"
  }

  /// A task notice: the task's title (a fixed line when it has none) over a fixed line for its
  /// kind, followed by the notice's preview while previews are on and it has one, so an error or
  /// an action awaiting approval still says what happened. A question is the exception: shown, it
  /// says by itself that an answer is awaited, so it takes the whole body, which a banner cuts to
  /// two lines. A question or an approval offers its actions only when
  /// the notice names its request and previews are on: without the question or the action on
  /// screen, a Reply, an option or a Decline would be answered blind, so the notification only
  /// opens the task then. Nil for a `resolved` notice, which takes a notification back instead of
  /// showing one.
  public init?(_ notice: TaskNotice, text: ShellText, previews: Bool, sound: Bool) {
    let title = notice.taskTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let preview = previews ? Self.shown(notice.preview) : nil
    let fixed: String
    let category: Category
    let relevance: Double
    switch notice.kind {
    case .needsInput:
      fixed = text(.taskNoticeNeedsInputBody)
      category = notice.request == nil || !previews ? .task : .taskNeedsInput
      relevance = 1
    case .needsConfirmation:
      fixed = text(.taskNoticeNeedsConfirmationBody)
      category = notice.request == nil || !previews ? .task : .taskNeedsConfirmation
      relevance = 1
    case .completed:
      fixed = text(.taskNoticeCompletedBody)
      category = .task
      relevance = 0.5
    case .failed:
      fixed = text(.taskNoticeFailedBody)
      category = .task
      relevance = 0.8
    case .resolved:
      return nil
    }
    self.init(
      identifier: Self.taskIdentifier(notice.taskId),
      title: title.isEmpty ? text(.taskNoticeFallbackTitle) : title,
      body: notice.kind == .needsInput
        ? preview ?? fixed : [fixed, preview].compactMap(\.self).joined(separator: "\n"),
      threadIdentifier: notice.taskId, category: category, taskId: notice.taskId,
      request: category == .task ? nil : notice.request,
      options: previews ? notice.options.filter { Self.shown($0) != nil } : [],
      relevance: relevance, sound: sound)
  }

  /// Runtime text worth showing: nil when absent or blank.
  static func shown(_ text: String?) -> String? {
    guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty
    else { return nil }
    return trimmed
  }

  /// The longest option title, in characters, a notification's action button shows whole.
  public static let maxOptionTitle = 40

  /// An option as its action's button shows it: on one line, and cut short with an ellipsis past
  /// ``maxOptionTitle`` characters. The answer the action sends is the full option.
  public static func optionTitle(_ option: String) -> String {
    let line = option.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard line.count > maxOptionTitle else { return line }
    return line.prefix(maxOptionTitle - 1).trimmingCharacters(in: .whitespaces) + "…"
  }
}
