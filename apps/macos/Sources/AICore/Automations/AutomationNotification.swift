import Foundation

/// The system notification that shows an ``AutomationNotice``. Its title and body come from the
/// String Catalog in the shell's language (`text`), around the automation's name and the run's
/// summary, which go in as the service wrote them:
/// - `delivered`: the automation's name, over the summary or a line saying the result is ready;
/// - `needsAttention`: how many actions or questions were declined because nobody was there,
///   then the summary;
/// - `failed`: the summary or error, or a line saying the run did not finish;
/// - `paused`: why it was turned off and where to turn it back on.
public struct AutomationNotification: Equatable, Sendable {
  /// The notice's id: posting the same notice again replaces its notification.
  public let identifier: String
  public let title: String
  public let body: String
  /// The automation's id, so Notification Center groups an automation's notifications.
  public let threadIdentifier: String
  /// The task a click opens.
  public let taskId: String?

  public init(_ notice: AutomationNotice, text: ShellText) {
    identifier = notice.id
    threadIdentifier = notice.automationId
    taskId = notice.taskId
    let name = notice.automationName
    let summary = notice.summary?.trimmingCharacters(in: .whitespacesAndNewlines)
    let shown = summary?.isEmpty == false ? summary : nil
    switch notice.kind {
    case .delivered:
      title = name
      body = shown ?? text(.automationNoticeDeliveredBody)
    case .needsAttention:
      title = text(.automationNoticeAttentionTitle, name)
      let declined =
        switch notice.declined ?? 0 {
        case 0: text(.automationNoticeAttentionBody)
        case 1: text(.automationNoticeDeclinedOne)
        case let count: text(.automationNoticeDeclinedOther, count)
        }
      body = [declined, shown].compactMap(\.self).joined(separator: "\n")
    case .failed:
      title = text(.automationNoticeFailedTitle, name)
      body = shown ?? text(.automationNoticeFailedBody)
    case .paused:
      title = text(.automationNoticePausedTitle, name)
      body = text(.automationNoticePausedBody)
    }
  }
}
