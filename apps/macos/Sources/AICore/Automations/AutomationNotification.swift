extension SystemNotification {
  /// The notification that shows an ``AutomationNotice``: fixed wording from the String Catalog
  /// around the automation's name and, while `previews` is on, the run's summary, which goes in as
  /// the service wrote it:
  /// - `delivered`: the automation's name, over the summary or a line saying the result is ready;
  /// - `needsAttention`: how many actions or questions were declined because nobody was there,
  ///   then the summary;
  /// - `failed`: the summary or error, or a line saying the run did not finish;
  /// - `paused`: why it was turned off and where to turn it back on.
  ///
  /// The notice's id identifies it, so posting the same notice again replaces its notification;
  /// the automation's id groups an automation's notifications. It ranks below a task waiting on
  /// the person or a failed task, above a finished one.
  public init(_ notice: AutomationNotice, text: ShellText, previews: Bool, sound: Bool) {
    let name = notice.automationName
    let shown = previews ? Self.shown(notice.summary) : nil
    let title: String
    let body: String
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
    self.init(
      identifier: notice.id, title: title, body: body, threadIdentifier: notice.automationId,
      category: .automation, taskId: notice.taskId, request: nil, relevance: 0.6,
      sound: sound)
  }
}
