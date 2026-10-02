import Foundation

/// How Edit › Paste in the panel treats the general pasteboard.
public enum PasteboardPaste {
  public enum Route: Equatable, Sendable {
    /// Import the file URLs as attachments.
    case files
    /// Import the bitmap as an image attachment instead of pasting it into the editor.
    case image
    /// WebKit's own paste.
    case webKit
  }

  /// File URLs win; a bitmap becomes an attachment only when nothing else on the pasteboard is
  /// text, because a copy from a spreadsheet or a web page carries both a rendering and its
  /// text, and the text is what the user means to paste.
  public static func route(hasFileURLs: Bool, hasText: Bool, hasImage: Bool) -> Route {
    if hasFileURLs { return .files }
    return hasImage && !hasText ? .image : .webKit
  }
}

/// The name of a pasted bitmap, which has no file name of its own.
public enum PastedImageName {
  /// `Pasted image 2026-10-01 at 10.16.11.png` in the user's time zone, shaped like
  /// ``ScreenshotRules/fileName(capturedAt:encoding:timeZone:)``. The name is data the page and
  /// the model read, so it stays English.
  public static func fileName(
    pastedAt date: Date, encoding: ScreenshotEncoding = .png, timeZone: TimeZone = .current
  ) -> String {
    let style = Date.VerbatimFormatStyle(
      format: """
        Pasted image \(year: .extended(minimumLength: 4))-\(month: .twoDigits)-\(day: .twoDigits) \
        at \(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)).\
        \(minute: .twoDigits).\(second: .twoDigits)
        """,
      locale: Locale(identifier: "en_US_POSIX"), timeZone: timeZone,
      calendar: Calendar(identifier: .gregorian))
    return date.formatted(style) + "." + encoding.fileExtension
  }
}
