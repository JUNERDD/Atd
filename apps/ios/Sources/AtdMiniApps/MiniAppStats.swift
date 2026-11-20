import Foundation

/// What a daily series adds up to around today: what pages read as `atd.stats.<field>` and what
/// widgets draw, computed by this one function so the two never disagree.
public struct MiniAppSeriesStats: Sendable, Equatable, Codable {
  /// Today's value (0 when nothing was logged).
  public var today: Double
  /// Whether today counts: it reached the goal, or, without one, has anything above 0.
  public var doneToday: Bool
  /// Days in a row that count, ending today when today counts and yesterday otherwise.
  public var streak: Int
  /// The last seven days' values, oldest first, today last.
  public var week: [Double]
  /// Whether each of those days counts.
  public var weekDone: [Bool]
  /// The weekday of each of those days, as short as the locale writes it (一, M).
  public var weekLabels: [String]
  /// The sum over this calendar month.
  public var month: Double
  /// The sum over every day kept.
  public var total: Double

  public init(
    series: [String: Double], goal: Double?, now: Date, calendar: Calendar = MiniAppDay.calendar(),
    locale: Locale = .current
  ) {
    let goal = goal.flatMap { $0 > 0 && $0.isFinite ? $0 : nil }
    func counts(_ value: Double) -> Bool {
      if let goal { value >= goal } else { value > 0 }
    }
    let todayStart = calendar.startOfDay(for: now)
    func day(_ offset: Int) -> Date {
      calendar.date(byAdding: .day, value: offset, to: todayStart) ?? todayStart
    }
    func value(_ date: Date) -> Double {
      series[MiniAppDay.key(date, calendar: calendar)] ?? 0
    }
    today = value(todayStart)
    doneToday = counts(today)
    var run = 0
    while run < MiniAppLimits.days, counts(value(day(-run - 1))) { run += 1 }
    streak = run + (doneToday ? 1 : 0)
    let days = (-6...0).map(day)
    week = days.map(value)
    weekDone = week.map(counts)
    var weekdays = calendar
    weekdays.locale = locale
    let symbols = weekdays.veryShortStandaloneWeekdaySymbols
    weekLabels = days.map { date in
      let index = calendar.component(.weekday, from: date) - 1
      return symbols.indices.contains(index) ? symbols[index] : ""
    }
    let month = calendar.dateInterval(of: .month, for: now)
    self.month = series.reduce(0) { sum, entry in
      // The interval's end is the next month's first day, which does not belong to this one.
      guard let month, let date = MiniAppDay.date(entry.key, calendar: calendar),
        month.start <= date, date < month.end
      else { return sum }
      return sum + entry.value
    }
    total = series.values.reduce(0, +)
  }

  /// The JSON a page reads.
  public var json: MiniAppJSON {
    .object([
      "today": .number(today), "doneToday": .bool(doneToday), "streak": .number(Double(streak)),
      "week": .array(week.map(MiniAppJSON.number)),
      "weekDone": .array(weekDone.map(MiniAppJSON.bool)),
      "weekLabels": .array(weekLabels.map(MiniAppJSON.string)), "month": .number(month),
      "total": .number(total),
    ])
  }
}

extension MiniAppDay {
  /// Whole days from today to the day `key` names: 0 today, negative once it has passed.
  public static func days(until key: String, now: Date, calendar: Calendar) -> Int? {
    guard let target = date(key, calendar: calendar) else { return nil }
    return calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: target).day
  }
}
