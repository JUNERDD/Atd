import Foundation

/// What is on one day: the calendar's events and the reminders due, as plain values read from
/// Calendar and Reminders (AtdActions' `TodayReader`). It is the one input 今日简报, automation
/// steps and the Lock Screen's 下一项 read the day from, so the briefing prompt
/// (`CardInput.agenda`) always sees it the same way.
public struct Agenda: Codable, Sendable, Equatable {
  /// The start of the day.
  public var day: Date
  /// The events that overlap the day, by start; nil when Atd cannot read the calendar, which is
  /// not the same as an empty day.
  public var events: [AgendaEvent]?
  /// The incomplete reminders due by the end of the day, overdue ones included, by due date; nil
  /// when Atd cannot read reminders.
  public var reminders: [AgendaReminder]?

  public init(day: Date, events: [AgendaEvent]?, reminders: [AgendaReminder]?) {
    self.day = day
    self.events = events
    self.reminders = reminders
  }
}

public struct AgendaEvent: Codable, Sendable, Equatable, Hashable {
  public var title: String
  public var start: Date
  public var end: Date
  public var isAllDay: Bool
  public var location: String?

  public init(title: String, start: Date, end: Date, isAllDay: Bool, location: String? = nil) {
    self.title = title
    self.start = start
    self.end = end
    self.isAllDay = isAllDay
    self.location = location
  }
}

public struct AgendaReminder: Codable, Sendable, Equatable, Hashable {
  public var title: String
  /// When it is due: the moment, or the start of the day for a reminder without a time.
  public var due: Date
  public var hasDueTime: Bool

  public init(title: String, due: Date, hasDueTime: Bool) {
    self.title = title
    self.due = due
    self.hasDueTime = hasDueTime
  }

  /// Whether it is past due at `now`: a reminder with a time once the time has passed, one
  /// without a time once its day has.
  public func isOverdue(at now: Date, calendar: Calendar = .current) -> Bool {
    hasDueTime ? due < now : due < calendar.startOfDay(for: now)
  }
}
