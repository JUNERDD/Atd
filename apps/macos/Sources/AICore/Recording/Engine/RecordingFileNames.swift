import Foundation

/// The names of a recording's files. Like a screenshot's
/// (``ScreenshotRules/fileName(capturedAt:encoding:timeZone:)``) they are data the page and the
/// model read, so they stay English, with the 24-hour clock of the system's own
/// `Screen Recording 2026-11-07 at 10.15.32` names; the context file and the key frames carry the
/// movie's stem so they sort and read with it.
public enum RecordingFileNames {
  /// The movie: `Screen Recording 2026-11-07 at 10.15.32.mp4`.
  public static func movie(startedAt date: Date, timeZone: TimeZone = .current) -> String {
    stem(startedAt: date, timeZone: timeZone) + ".mp4"
  }

  /// The context file beside it: `Screen Recording 2026-11-07 at 10.15.32 context.md`.
  public static func context(startedAt date: Date, timeZone: TimeZone = .current) -> String {
    stem(startedAt: date, timeZone: timeZone) + " context.md"
  }

  /// The key frame at media `time`: `Screen Recording 2026-11-07 at 10.15.32 0m04.2s.jpg`.
  public static func keyframe(startedAt date: Date, time: Double, timeZone: TimeZone = .current)
    -> String
  {
    let tenths = Int((max(0, time) * 10).rounded())
    let minutes = tenths / 600
    let seconds = Double(tenths % 600) / 10
    let clock = String(
      format: "%dm%04.1fs", locale: Locale(identifier: "en_US_POSIX"), minutes, seconds)
    return stem(startedAt: date, timeZone: timeZone) + " " + clock + ".jpg"
  }

  /// `name`, or `name (2)`, `name (3)` and so on before its extension, whichever `isTaken`
  /// answers false for first.
  public static func unique(_ name: String, isTaken: (String) -> Bool) -> String {
    guard isTaken(name) else { return name }
    let dot = name.lastIndex(of: ".")
    let base = dot.map { String(name[..<$0]) } ?? name
    let suffix = dot.map { String(name[$0...]) } ?? ""
    var number = 2
    while isTaken("\(base) (\(number))\(suffix)") { number += 1 }
    return "\(base) (\(number))\(suffix)"
  }

  private static func stem(startedAt date: Date, timeZone: TimeZone) -> String {
    let style = Date.VerbatimFormatStyle(
      format: """
        Screen Recording \(year: .extended(minimumLength: 4))-\(month: .twoDigits)-\(day: .twoDigits) \
        at \(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)).\
        \(minute: .twoDigits).\(second: .twoDigits)
        """,
      locale: Locale(identifier: "en_US_POSIX"), timeZone: timeZone,
      calendar: Calendar(identifier: .gregorian))
    return date.formatted(style)
  }
}
