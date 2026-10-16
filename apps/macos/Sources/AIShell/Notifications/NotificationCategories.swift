import AICore
import UserNotifications

/// The categories Atd's notifications are posted under, kept as the one set the system holds
/// (`setNotificationCategories` replaces it whole): the fixed ``SystemNotification/Category``
/// cases, and one per question that offers its suggested answers
/// (``SystemNotification/categoryIdentifier``), whose actions are those answers followed by Reply.
///
/// A question's category lives while its notification may still be on screen: it is registered
/// before the notification is posted, and dropped when that notification is replaced or removed
/// or its request is settled elsewhere. A notification the person dismissed leaves no trace here,
/// so at most ``maxQuestions`` such categories stay, the oldest dropped first. The first
/// registration of a launch also brings back the categories of questions an earlier run left in
/// Notification Center, so their actions keep working.
///
/// No action approves: a notification shows too little of a guarded action to approve it, so
/// approving stays in the panel, where the action shows in full.
final class NotificationCategories {
  /// Action identifiers ``NotificationResponder`` routes.
  nonisolated static let replyAction = "reply"
  nonisolated static let denyAction = "deny"
  /// An option's action: this prefix and the option's index in the notification's options
  /// (``ShellNotifier/optionsKey``), whose full text the action answers with.
  nonisolated static let optionActionPrefix = "option."
  /// The most questions whose own categories stay registered.
  static let maxQuestions = 16

  /// A question's notification and the category registered for it.
  private struct Question {
    let notification: String
    let category: String
    let requestId: String
    let options: [String]
  }

  private let text: () -> ShellText
  /// Oldest first.
  private var questions: [Question] = []
  private var restored = false

  /// - Parameter text: the String Catalog in the current language.
  init(text: @escaping () -> ShellText) { self.text = text }

  /// Registers the set worded in the current language; at launch and on every language change.
  func register() {
    publish()
    guard !restored else { return }
    restored = true
    Task { await restoreDelivered() }
  }

  /// Before `notification` is posted: the category of the question it replaces goes, and its own
  /// comes when it offers options. Returns once the system has the new set, which it applies
  /// asynchronously; reading the set back waits for that, so the notification shows its actions.
  func prepare(_ notification: SystemNotification) async {
    let replaced = questions.contains { $0.notification == notification.identifier }
    questions.removeAll { $0.notification == notification.identifier }
    guard let request = notification.request, !notification.options.isEmpty else {
      if replaced { publish() }
      return
    }
    questions.append(
      Question(
        notification: notification.identifier, category: notification.categoryIdentifier,
        requestId: request.id, options: notification.options))
    publish()
    _ = await UNUserNotificationCenter.current().notificationCategories()
  }

  /// The notifications went away, and with them their questions' categories.
  func forget(notifications identifiers: [String]) {
    forget { identifiers.contains($0.notification) }
  }

  /// The request was settled elsewhere; its question's category goes whether or not the
  /// notification is still delivered.
  func forget(requestId: String) {
    forget { $0.requestId == requestId }
  }

  private func forget(where matches: (Question) -> Bool) {
    let count = questions.count
    questions.removeAll(where: matches)
    if questions.count != count { publish() }
  }

  /// Questions with options still in Notification Center, from their notifications' `userInfo`.
  private func restoreDelivered() async {
    let prefix = "\(SystemNotification.Category.taskNeedsInput.rawValue)."
    let delivered = await UNUserNotificationCenter.current().deliveredNotifications()
    let found = delivered.sorted { $0.date < $1.date }.compactMap { delivered -> Question? in
      let request = delivered.request
      let content = request.content
      guard content.categoryIdentifier.hasPrefix(prefix),
        let requestId = content.userInfo[ShellNotifier.requestIdKey] as? String,
        let options = content.userInfo[ShellNotifier.optionsKey] as? [String], !options.isEmpty
      else { return nil }
      return Question(
        notification: request.identifier, category: content.categoryIdentifier,
        requestId: requestId, options: options)
    }
    // A question posted while this read ran is newer than anything delivered before it.
    let current = Set(questions.map(\.notification))
    let earlier = found.filter { !current.contains($0.notification) }
    guard !earlier.isEmpty else { return }
    questions = earlier + questions
    publish()
  }

  /// Hands the whole set to the system, keeping only the newest questions.
  private func publish() {
    if questions.count > Self.maxQuestions {
      questions.removeFirst(questions.count - Self.maxQuestions)
    }
    let text = text()
    let placeholder = text(.notificationHiddenPreview)
    let category = { (identifier: String, actions: [UNNotificationAction]) in
      UNNotificationCategory(
        identifier: identifier, actions: actions, intentIdentifiers: [],
        hiddenPreviewsBodyPlaceholder: placeholder, options: [])
    }
    var categories = Set(
      SystemNotification.Category.allCases.map { category($0.rawValue, Self.actions($0, text)) })
    for question in questions {
      let options = question.options.enumerated().map { index, option in
        // No icon: the same glyph on every answer would tell them apart no better than the text.
        UNNotificationAction(
          identifier: "\(Self.optionActionPrefix)\(index)",
          title: SystemNotification.optionTitle(option), options: [.authenticationRequired])
      }
      categories.insert(category(question.category, options + [Self.reply(text)]))
    }
    UNUserNotificationCenter.current().setNotificationCategories(categories)
  }

  /// A fixed category's actions: a question offers Reply, an approval Deny.
  private static func actions(_ category: SystemNotification.Category, _ text: ShellText)
    -> [UNNotificationAction]
  {
    switch category {
    case .automation, .task:
      []
    case .taskNeedsInput:
      [reply(text)]
    case .taskNeedsConfirmation:
      [
        UNNotificationAction(
          identifier: denyAction, title: text(.notificationDeny), options: [.destructive],
          icon: UNNotificationActionIcon(systemImageName: "xmark"))
      ]
    }
  }

  /// Reply asks to unlock first: an answer from a locked Mac would act for whoever is at it.
  private static func reply(_ text: ShellText) -> UNNotificationAction {
    UNTextInputNotificationAction(
      identifier: replyAction, title: text(.notificationReply), options: [.authenticationRequired],
      icon: UNNotificationActionIcon(systemImageName: "arrowshape.turn.up.left"),
      textInputButtonTitle: text(.notificationReplySend),
      textInputPlaceholder: text(.notificationReplyPlaceholder))
  }
}
