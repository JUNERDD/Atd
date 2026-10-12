import CoreGraphics

/// Where the typing trace of a paced `text.write` paste goes (``TypingPace``): a glow at the
/// insertion point and a wash behind each chunk as it lands. The field's glyphs are the target
/// app's own, so both are drawn on an overlay above it, placed from Accessibility bounds in
/// Quartz points. Apps answer those unevenly (zeros, the whole field, a block over every line a
/// range crosses), so a rect is drawn only when ``admits(_:within:)`` takes it, and a run that
/// spans lines is washed line by line (``slices(of:lines:)``) or not at all.
public enum InsertionTrace {
  /// The most lines one wash covers: the latest ones, next to the insertion point.
  public static let maxWashLines = 6
  /// The tallest rect taken as a line of text.
  public static let maxLineHeight: CGFloat = 120
  /// How far past the field's frame a rect may reach, for glyphs drawn into its padding.
  public static let fieldSlack: CGFloat = 8

  /// A range of the field's text in UTF-16 units, as Accessibility counts it.
  public struct Span: Equatable, Sendable {
    public let location: Int
    public let length: Int
    public var end: Int { location + length }

    public init(location: Int, length: Int) {
      self.location = location
      self.length = length
    }
  }

  /// Text that went in: from where the caret was to where it is, the last visible character in
  /// it, which the glow follows (nil when the text is only line breaks), and where its line breaks
  /// sit, which no wash covers.
  public struct Run: Equatable, Sendable {
    public private(set) var span: Span
    public private(set) var anchor: Span?
    /// The field locations of the run's line breaks, counted from `span`'s start as
    /// ``PasteProgress`` counts the text (a "\r\n" once).
    public private(set) var breaks: Set<Int>

    /// The run of `text`, confirmed in when the caret moved from `start` to `end`.
    public init(_ text: String, from start: Int, to end: Int) {
      span = Span(location: start, length: max(0, end - start))
      anchor = InsertionTrace.anchor(of: text, endingAt: end)
      var breaks = Set<Int>()
      var location = start
      for character in text {
        if character.isNewline { breaks.insert(location) }
        location += character == "\r\n" ? 1 : character.utf16.count
      }
      self.breaks = breaks
    }

    /// `part` of the run less its trailing line breaks, whose bounds reach to the end of their
    /// line in many fields; nil when nothing else is left.
    public func trimmed(_ part: Span) -> Span? {
      var length = part.length
      while length > 0, breaks.contains(part.location + length - 1) { length -= 1 }
      return length > 0 ? Span(location: part.location, length: length) : nil
    }

    /// Takes in a later run that went in right after this one: chunks waiting for the same read
    /// are contiguous, so one span covers them, and the glow goes to the latest character.
    public mutating func merge(_ later: Run) {
      let start = min(span.location, later.span.location)
      span = Span(location: start, length: max(span.end, later.span.end) - start)
      anchor = later.anchor ?? anchor
      breaks.formUnion(later.breaks)
    }
  }

  /// The last visible character of `text` when its end sits at `end`: trailing line breaks are
  /// stepped over (a "\r\n" counted once, as ``PasteProgress`` counts it), since a break's bounds
  /// say nothing about where the glyphs end. Nil when `text` is only line breaks.
  public static func anchor(of text: String, endingAt end: Int) -> Span? {
    var breaks = 0
    for character in text.reversed() {
      if character.isNewline {
        breaks += character == "\r\n" ? 1 : character.utf16.count
        continue
      }
      let length = character.utf16.count
      return Span(location: end - breaks - length, length: length)
    }
    return nil
  }

  /// The parts of `span` on each of `lines` (the ranges of the lines it touches, in order), for
  /// the latest ``maxWashLines`` lines only.
  public static func slices(of span: Span, lines: [Span]) -> [Span] {
    let parts = lines.compactMap { line -> Span? in
      let start = max(span.location, line.location)
      let end = min(span.end, line.end)
      return end > start ? Span(location: start, length: end - start) : nil
    }
    return Array(parts.suffix(maxWashLines))
  }

  /// Whether `rect` reads as text on screen: finite, no taller than a line, not the zero rect
  /// some apps answer, and on the field (`field`, its frame, when the field reported one).
  public static func admits(_ rect: CGRect, within field: CGRect?) -> Bool {
    guard !rect.isNull, !rect.isInfinite, rect.height > 1, rect.height <= maxLineHeight,
      rect.origin != .zero
    else { return false }
    guard let field, !field.isEmpty else { return true }
    return rect.intersects(field.insetBy(dx: -fieldSlack, dy: -fieldSlack))
  }

  /// Whether `bounds`, a run's bounds, covers more than one line of `lineHeight`.
  public static func spansLines(_ bounds: CGRect, lineHeight: CGFloat) -> Bool {
    bounds.height > lineHeight * 1.5
  }

  /// The part of `display` (Quartz) the overlay covers: the field's frame with `margin` around
  /// it when the field reported one that `first`, the first rect drawn, lies on; the whole
  /// display otherwise. Nil when nothing of it is on the display.
  public static func coverage(field: CGRect?, first: CGRect, display: CGRect, margin: CGFloat)
    -> CGRect?
  {
    var base = display
    if let field, !field.isEmpty, field.insetBy(dx: -fieldSlack, dy: -fieldSlack).intersects(first)
    {
      base = field.union(first).insetBy(dx: -margin, dy: -margin)
    }
    let cut = base.intersection(display)
    return cut.isNull || cut.isEmpty ? nil : cut
  }
}
