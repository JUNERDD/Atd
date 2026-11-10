import CoreGraphics
import Foundation

/// The context attachment of a long screenshot (decision D8): the app and window it was taken in
/// and the recognized text of what it keeps, grouped by the pages the service reads the image as
/// (``LongScreenshotPages``), as Markdown for the model. Like a screenshot's
/// (``ScreenContext``), its labels stay English whatever the app's language, because the file is
/// data the model reads; it has its own, larger cap, because a long screenshot holds many
/// screens of text.
public struct LongScreenshotContext: Equatable, Sendable {
  /// The whole file stays within this many characters; recognized text is cut to fit.
  public static let maxCharacters = 40_000

  public var app: String?
  public var window: String?
  /// Each page's recognized lines in reading order, top to bottom; a page may have none.
  public var pages: [[String]]

  public init(app: String?, window: String?, pages: [[String]]) {
    self.app = app
    self.window = window
    self.pages = pages
  }

  /// The context of `kept` of `source`, attached as a file of `pixelWidth` × `pixelHeight`: the
  /// lines the range keeps (``LongScreenshotKept/keeps(_:)``), each on the page its centre falls
  /// on, less every line the cover or a mosaic drawn on the image touches
  /// (``LongScreenshotExportRules/hiddenAreas(of:kept:)``), as the card counts the lines it sends
  /// (``LongScreenshotCardState/keptLines``) and as a screenshot's context leaves out what its
  /// mosaics hide (``ScreenContext/unredacted(_:hiding:)``); and the app's name and the window's
  /// title unless they could repeat what is hidden (``fields(app:window:covered:redacted:)``).
  public init(
    source: LongScreenshotCardSource, kept: LongScreenshotKept, pixelWidth: Int, pixelHeight: Int
  ) {
    let hidden = LongScreenshotExportRules.hiddenAreas(of: source, kept: kept)
      .map { $0.offsetBy(dx: 0, dy: -kept.top) }
    let lines = source.lines.compactMap { line -> ScreenContext.TextBox? in
      guard kept.keeps(line.box) else { return nil }
      return ScreenContext.TextBox(text: line.text, box: line.box.offsetBy(dx: 0, dy: -kept.top))
    }
    let (app, window) = Self.fields(
      app: source.shot.appName, window: source.shot.windowTitle, covered: kept.covered,
      redacted: kept.redacts)
    self.init(
      app: app, window: window,
      pages: Self.pages(
        ScreenContext.unredacted(lines, hiding: hidden), height: kept.bottom - kept.top,
        pixelWidth: pixelWidth, pixelHeight: pixelHeight))
  }

  /// The app's name and the window's title as the kept range may show them. A mosaic in the range
  /// (`redacted`) takes both, as a screenshot's context does (``ScreenContext``): either may
  /// repeat what it hides, and comparing them with the hidden text cannot rule that out. A
  /// covered range hides exactly the parts ``SensitiveText`` finds, so a name or title in which it
  /// finds one goes (the window list names them whatever the screen shows). Otherwise both stay.
  static func fields(app: String?, window: String?, covered: Bool, redacted: Bool) -> (
    String?, String?
  ) {
    guard !redacted else { return (nil, nil) }
    guard covered else { return (app, window) }
    func shown(_ value: String?) -> String? {
      value.flatMap { SensitiveText.matches(in: $0).isEmpty ? $0 : nil }
    }
    return (shown(app), shown(window))
  }

  /// `boxes` (points of an image `height` points tall) by page: each on the page of a
  /// `pixelWidth` × `pixelHeight` file its centre falls on, each page in reading order.
  static func pages(
    _ boxes: [ScreenContext.TextBox], height: CGFloat, pixelWidth: Int, pixelHeight: Int
  )
    -> [[String]]
  {
    let rows = LongScreenshotPages.rows(pixelWidth: pixelWidth, pixelHeight: pixelHeight)
    guard !rows.isEmpty, height > 0 else { return [] }
    var pages = Array(repeating: [ScreenContext.TextBox](), count: rows.count)
    for box in boxes {
      let row = Int(box.box.midY / height * CGFloat(pixelHeight))
      let page = rows.firstIndex { $0.contains(row) } ?? (row < 0 ? 0 : rows.count - 1)
      pages[page].append(box)
    }
    return pages.map(ScreenContext.readingOrder)
  }

  /// The file's Markdown, at most ``maxCharacters`` long; nil when nothing is known, so no file
  /// is written. Pages without text are left out, the others keep their numbers.
  public var markdown: String? {
    var facts: [String] = []
    if let app = ScreenContext.inline(app) { facts.append("- App: \(app)") }
    if let window = ScreenContext.inline(window) { facts.append("- Window: \(window)") }
    let sections = pages.enumerated().compactMap { index, lines -> (String, [String])? in
      let text = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
      return text.isEmpty ? nil : ("## Page \(index + 1)", text)
    }
    guard !facts.isEmpty || !sections.isEmpty else { return nil }
    var head = "# Long screenshot context\n"
    if !facts.isEmpty { head += "\n" + facts.joined(separator: "\n") + "\n" }
    if !sections.isEmpty {
      head += "\nRecognized text, by the pages the image is read as, top to bottom.\n"
    }
    return Self.capped(head: head, sections: sections)
  }

  /// `head` followed by as much of `sections` as fits in whole lines, then the marker when some
  /// were left out. Only the very first line is cut mid-way when it is too long for the room:
  /// otherwise whole lines read better than a stub, as in a screenshot's context.
  static func capped(head: String, sections: [(String, [String])]) -> String {
    let marker = "\n" + ScreenContext.truncationMarker + "\n"
    let room = maxCharacters - marker.count
    guard head.count < room else { return String(head.prefix(maxCharacters)) }
    var body = head
    // Counted as it grows: a String's count walks the whole string.
    var length = head.count
    var wroteLine = false
    func append(_ piece: String) -> Bool {
      guard length + piece.count <= room else { return false }
      body += piece
      length += piece.count
      return true
    }
    for (heading, lines) in sections {
      guard append("\n" + heading + "\n\n") else { return body + marker }
      for (index, line) in lines.enumerated() {
        guard append((index == 0 ? "" : "\n") + line) else {
          if !wroteLine { body += line.prefix(room - length) }
          return body + marker
        }
        wroteLine = true
      }
      guard append("\n") else { return body + marker }
    }
    return body
  }
}
