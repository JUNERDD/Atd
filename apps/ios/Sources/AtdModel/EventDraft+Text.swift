import Foundation
import NaturalLanguage

extension EventDraft {
  /// The event as plain text to copy (拷贝日程) when it cannot go into Calendar: its title, when
  /// it is, where and its notes, a line each. The date reads in the language the event itself is
  /// written in (11月21日 周六 14:00 – 16:00, or Sat, Nov 21, 2:00 – 4:00 PM), so the text is
  /// one language throughout; the person's own when the text does not tell. An event without an
  /// end shows only its start.
  public func plainText(timeZone: TimeZone = .current) -> String {
    let locale = contentLocale
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let day = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: timeZone)
      .month(.abbreviated).day().weekday(.abbreviated)
    let days = Date.IntervalFormatStyle(locale: locale, calendar: calendar, timeZone: timeZone)
      .month(.abbreviated).day().weekday(.abbreviated)
    let when: String
    switch (isAllDay, end) {
    case (true, let end?) where !calendar.isDate(end, inSameDayAs: start):
      when = days.format(start..<end)
    case (true, _):
      when = day.format(start)
    case (false, let end?) where end > start:
      when = days.hour().minute().format(start..<end)
    case (false, _):
      when = day.hour().minute().format(start)
    }
    return [title, when, location, notes].compactMap { $0 }.joined(separator: "\n")
  }

  /// The language of the event's title, place and notes; the person's own when it is unclear.
  private var contentLocale: Locale {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString([title, location, notes].compactMap { $0 }.joined(separator: " "))
    guard let language = recognizer.dominantLanguage, language != .undetermined else {
      return .current
    }
    return Locale(identifier: language.rawValue)
  }
}
