import AtdModel
import Foundation

/// What a step's row says before, while and after it runs, in the app's language. A run writes
/// these into its records, so its Live Activity, the app and the Shortcuts result all show the
/// same words.
enum StepText {
  /// Before the step runs: 看明天的日程, 发给妈妈“到家了”.
  static func waiting(_ step: AutomationStep, commands: CommandLibrary) -> String {
    switch step {
    case .agenda(.today): text("step.agenda.today")
    case .agenda(.tomorrow): text("step.agenda.tomorrow")
    case .ledgerToday: text("step.ledger")
    case .briefing(.today): text("step.briefing.today")
    case .briefing(.tomorrow): text("step.briefing.tomorrow")
    case .command(let id): commandName(id, in: commands)
    case .message(let draft):
      draft.recipients.isEmpty
        ? text("step.message \(draft.body)")
        : text("step.message.to \(names(draft)) \(draft.body)")
    case .focus(let label): text("step.focus \(label)")
    }
  }

  /// While the step runs: 正在看明天的日程….
  static func running(_ step: AutomationStep, commands: CommandLibrary) -> String {
    switch step {
    case .agenda(.today): text("step.agenda.today.running")
    case .agenda(.tomorrow): text("step.agenda.tomorrow.running")
    case .ledgerToday: text("step.ledger.running")
    case .briefing(.today): text("step.briefing.today.running")
    case .briefing(.tomorrow): text("step.briefing.tomorrow.running")
    case .command(let id): text("step.command.running \(commandName(id, in: commands))")
    case .message, .focus: waiting(step, commands: commands)
    }
  }

  /// The name of the command with this id, or a stand-in once it was deleted.
  static func commandName(_ id: String, in commands: CommandLibrary) -> String {
    let name = commands.command(id)?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return name.isEmpty ? text("step.command.deleted") : name
  }

  // MARK: Messages

  /// What the person is asked: 发给妈妈：“到家了”.
  static func ask(_ draft: MessageDraft) -> String {
    draft.recipients.isEmpty
      ? text("message.ask \(draft.body)") : text("message.ask.to \(names(draft)) \(draft.body)")
  }

  static func sent(_ draft: MessageDraft) -> String {
    draft.recipients.isEmpty
      ? text("message.sent \(draft.body)") : text("message.sent.to \(names(draft)) \(draft.body)")
  }

  static func notSent(_ draft: MessageDraft) -> String {
    draft.recipients.isEmpty ? text("message.notSent") : text("message.notSent.to \(names(draft))")
  }

  static var sendFailed: String { text("message.failed") }

  /// Why the message was not offered: the iPhone has no way to send it now.
  static var cannotSend: String { text("message.cannotSend") }

  private static func names(_ draft: MessageDraft) -> String {
    draft.recipients.map(\.name).formatted(.list(type: .and, width: .narrow))
  }

  // MARK: Results

  /// A day's agenda in one line: its first event (a timed one before an all-day one) and how
  /// much more there is.
  static func agenda(_ agenda: Agenda, day: AgendaDay) -> String {
    let events = agenda.events ?? []
    let reminders = agenda.reminders ?? []
    guard let first = events.first(where: { !$0.isAllDay }) ?? events.first else {
      if reminders.isEmpty {
        return day == .today ? text("agenda.none.today") : text("agenda.none.tomorrow")
      }
      return day == .today
        ? text("agenda.reminders.today \(reminders.count)")
        : text("agenda.reminders.tomorrow \(reminders.count)")
    }
    let line: String =
      switch (day, first.isAllDay) {
      case (.today, false): text("agenda.first.today \(clock(first.start)) \(first.title)")
      case (.tomorrow, false): text("agenda.first.tomorrow \(clock(first.start)) \(first.title)")
      case (.today, true): text("agenda.allDay.today \(first.title)")
      case (.tomorrow, true): text("agenda.allDay.tomorrow \(first.title)")
      }
    let more = events.count + reminders.count - 1
    return more > 0 ? text("agenda.more \(line) \(more)") : line
  }

  /// The whole agenda, one item a line, for a later step to work on and for the result.
  static func listing(_ agenda: Agenda, day: AgendaDay) -> String {
    var lines = [Self.agenda(agenda, day: day)]
    for event in agenda.events ?? [] {
      let when =
        event.isAllDay ? text("agenda.allDayMark") : "\(clock(event.start))–\(clock(event.end))"
      lines.append(
        "- " + [when, event.title, event.location].compactMap { $0 }.joined(separator: " "))
    }
    for reminder in agenda.reminders ?? [] {
      lines.append("- " + text("agenda.reminder \(reminder.title)"))
    }
    return lines.joined(separator: "\n")
  }

  static var agendaDenied: String { text("agenda.denied") }

  /// Today's spending: 今天 3 笔，共 ¥68. Each currency is summed on its own.
  static func spending(_ spending: Spending) -> String {
    guard spending.count > 0 else { return text("spending.none") }
    let totals = spending.totals.sorted { $0.key < $1.key }.map { code, amount in
      amount.formatted(.currency(code: code).precision(.fractionLength(0...2)))
    }
    let sum = totals.joined(separator: " + ")
    return spending.count == 1
      ? text("spending.one \(sum)") : text("spending.many \(spending.count) \(sum)")
  }

  static var nothingToWorkOn: String { text("command.nothingToWorkOn") }
  static var notRun: String { text("step.notRun") }
  static var commandDeleted: String { text("command.deleted") }
  static var noResult: String { text("command.noResult") }

  /// The first line of an answer, which a row has room for.
  static func firstLine(_ text: String) -> String {
    text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
  }

  private static func clock(_ date: Date) -> String {
    date.formatted(date: .omitted, time: .shortened)
  }

  static func text(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }
}

extension AutomationStep {
  /// What the step does, as its row says before it runs: 看明天的日程, 润色.
  public func title(commands: CommandLibrary) -> String {
    StepText.waiting(self, commands: commands)
  }

  /// An SF Symbol name for the step's row.
  public func symbol(commands: CommandLibrary) -> String {
    switch self {
    case .agenda: "calendar"
    case .ledgerToday: "list.bullet.rectangle"
    case .briefing: "sunrise"
    case .command(let id): commands.command(id)?.symbol ?? "wand.and.sparkles"
    case .message: "message"
    case .focus: "timer"
    }
  }
}
