import AtdModel
import Foundation

/// How a day's agenda reads in the briefing's prompt, whoever asks for the briefing: 今日简报
/// from Siri or a control, or an automation step. The day can be any day; the prompt's current
/// time tells the model whether it is today.
extension CardPrompt {
  /// The day, then each event and each reminder on a line of its own; a list Atd cannot read
  /// says so rather than looking empty. Without an agenda, both lists are unreadable.
  static func agendaText(_ agenda: Agenda?, context: CardContext) -> String {
    let day = agenda?.day ?? context.calendar.startOfDay(for: context.now)
    var lines = [cards("card.agenda.day \(context.dayStamp(day)) \(context.weekday(day))")]
    lines.append(cards("card.agenda.events"))
    switch agenda?.events {
    case nil: lines.append(cards("card.agenda.noCalendar"))
    case let events? where events.isEmpty: lines.append(cards("card.agenda.none"))
    case let events?:
      lines += events.map { event in
        "- "
          + [time(of: event, on: day, context), event.title, event.location]
          .compactMap { $0 }.joined(separator: " · ")
      }
    }
    lines.append(cards("card.agenda.reminders"))
    switch agenda?.reminders {
    case nil: lines.append(cards("card.agenda.noReminders"))
    case let reminders? where reminders.isEmpty: lines.append(cards("card.agenda.none"))
    case let reminders?:
      lines += reminders.map { reminder in
        "- "
          + [due(of: reminder, on: day, context), reminder.title]
          .compactMap { $0 }.joined(separator: " ")
      }
    }
    return lines.joined(separator: "\n")
  }

  /// 15:00–16:00; a time on another day carries its date (11-20 09:00).
  private static func time(of event: AgendaEvent, on day: Date, _ context: CardContext)
    -> String
  {
    guard !event.isAllDay else { return cards("card.agenda.allDay") }
    let moment = { (date: Date) in
      context.calendar.isDate(date, inSameDayAs: day)
        ? context.clock(date) : "\(context.monthDay(date)) \(context.clock(date))"
    }
    return "\(moment(event.start))–\(moment(event.end))"
  }

  /// 19:00 on the day, nothing on the day without a time, 11-20 19:00 for an earlier day, and
  /// 已逾期 before that once it is past due.
  private static func due(of reminder: AgendaReminder, on day: Date, _ context: CardContext)
    -> String?
  {
    let time = reminder.hasDueTime ? context.clock(reminder.due) : nil
    guard !context.calendar.isDate(reminder.due, inSameDayAs: day) else { return time }
    let when = [context.monthDay(reminder.due), time].compactMap { $0 }.joined(separator: " ")
    let late = reminder.isOverdue(at: context.now, calendar: context.calendar)
    return late ? "\(cards("card.agenda.overdue")) \(when)" : when
  }
}
