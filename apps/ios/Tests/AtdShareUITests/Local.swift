import Foundation

/// Dates in the time zone cards are read in (`CardContext`'s default, the device's).
enum Local {
  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    return calendar
  }

  /// A moment in 2031.
  static func at(_ month: Int, _ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
    calendar.date(
      from: DateComponents(year: 2031, month: month, day: day, hour: hour, minute: minute))!
  }
}
