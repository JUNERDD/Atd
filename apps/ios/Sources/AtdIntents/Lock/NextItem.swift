import AtdModel
import Foundation

/// What the Lock Screen's 下一项 shows (prototype `nextEvent`): the event on now or next today,
/// else today's all-day event, else the first event of the coming days, with its day.
public struct NextItem: Equatable, Sendable {
  public enum Day: Equatable, Sendable {
    case today
    case tomorrow
    /// Later than tomorrow: the day is said as its weekday or date.
    case later
  }

  public var event: AgendaEvent
  public var day: Day

  public init(event: AgendaEvent, day: Day) {
    self.event = event
    self.day = day
  }

  /// How far ahead 下一项 looks.
  public static let days = 7

  /// The days `events` should cover: from the start of today, for what is on now, through the
  /// end of the last day 下一项 looks at.
  public static func interval(around now: Date, calendar: Calendar = .current) -> DateInterval {
    let today = calendar.startOfDay(for: now)
    let end = calendar.date(byAdding: .day, value: days + 1, to: today) ?? now
    return DateInterval(start: today, end: max(end, now))
  }

  /// - Parameter events: soonest first, as `TodayReader.events(in:)` reads them.
  public static func pick(_ events: [AgendaEvent], at now: Date, calendar: Calendar = .current)
    -> NextItem?
  {
    let today = calendar.startOfDay(for: now)
    let upcoming = events.filter { $0.end > now }
    let todays = upcoming.filter { calendar.isDate($0.start, inSameDayAs: now) || $0.start < today }
    let event =
      todays.first { !$0.isAllDay } ?? todays.first { $0.isAllDay }
      ?? upcoming.first { $0.start >= today }
    guard let event else { return nil }
    let start = max(event.start, today)
    let day: Day =
      calendar.isDate(start, inSameDayAs: now)
      ? .today : isDay(start, after: now, calendar: calendar) ? .tomorrow : .later
    return NextItem(event: event, day: day)
  }

  /// When 下一项 must change by itself: as each event still to come ends, and at the next
  /// midnight, when the days change their names; soonest first, at most `limit`.
  public static func changes(
    of events: [AgendaEvent], after now: Date, calendar: Calendar = .current, limit: Int = 10
  ) -> [Date] {
    let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
    let ends = Set(events.map(\.end).filter { $0 > now } + [midnight].compactMap { $0 })
    return Array(ends.sorted().prefix(limit))
  }

  /// Whether `date` falls on the day after `now`'s.
  private static func isDay(_ date: Date, after now: Date, calendar: Calendar) -> Bool {
    guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) else { return false }
    return calendar.isDate(date, inSameDayAs: tomorrow)
  }
}
