import CoreGraphics
import Testing

@testable import AICore

@Suite("Insertion trace")
struct InsertionTraceTests {
  typealias Span = InsertionTrace.Span

  @Test("The glow follows the last visible character, stepping over trailing line breaks")
  func anchor() {
    #expect(InsertionTrace.anchor(of: "ab", endingAt: 10) == Span(location: 9, length: 1))
    #expect(InsertionTrace.anchor(of: "a\n\n", endingAt: 10) == Span(location: 7, length: 1))
    // A CRLF is one line break, as the caret counts it.
    #expect(InsertionTrace.anchor(of: "a\r\n", endingAt: 10) == Span(location: 8, length: 1))
    #expect(InsertionTrace.anchor(of: "a\r\n\n", endingAt: 10) == Span(location: 7, length: 1))
    // Only line breaks, or nothing: no glyph to follow.
    #expect(InsertionTrace.anchor(of: "\n\r\n", endingAt: 10) == nil)
    #expect(InsertionTrace.anchor(of: "", endingAt: 10) == nil)
  }

  @Test("A character's anchor covers all of its UTF-16 units")
  func anchorGraphemes() {
    let family = "👩‍👩‍👧‍👦"
    #expect(
      InsertionTrace.anchor(of: "a" + family, endingAt: 20) == Span(location: 9, length: 11))
    #expect(InsertionTrace.anchor(of: "👍🏽\n", endingAt: 20) == Span(location: 15, length: 4))
    #expect(InsertionTrace.anchor(of: "e\u{301}", endingAt: 20) == Span(location: 18, length: 2))
  }

  @Test("A run spans the caret's move, and runs that went in one after another merge into one")
  func runMerge() {
    var run = InsertionTrace.Run("ab", from: 0, to: 2)
    #expect(run.span == Span(location: 0, length: 2))
    #expect(run.anchor == Span(location: 1, length: 1))
    run.merge(InsertionTrace.Run("cd", from: 2, to: 4))
    #expect(run.span == Span(location: 0, length: 4))
    #expect(run.anchor == Span(location: 3, length: 1))
    // A later run of line breaks only leaves the glow on the last glyph.
    run.merge(InsertionTrace.Run("\n\n", from: 4, to: 6))
    #expect(run.span == Span(location: 0, length: 6))
    #expect(run.anchor == Span(location: 3, length: 1))
    // A caret that did not advance gives an empty span, never a negative one.
    #expect(InsertionTrace.Run("x", from: 5, to: 3).span == Span(location: 5, length: 0))
  }

  @Test("A wash leaves out the run's trailing line breaks, merged runs' breaks included")
  func trimmed() {
    // a b \n c d \r\n \n: the CRLF counts once, so the breaks sit at 12, 15 and 16.
    var run = InsertionTrace.Run("ab\ncd\r\n\n", from: 10, to: 17)
    #expect(run.breaks == [12, 15, 16])
    #expect(run.trimmed(run.span) == Span(location: 10, length: 5))
    #expect(run.trimmed(Span(location: 10, length: 3)) == Span(location: 10, length: 2))
    // Only line breaks: nothing to wash.
    #expect(run.trimmed(Span(location: 15, length: 2)) == nil)
    run.merge(InsertionTrace.Run("x\n", from: 17, to: 19))
    #expect(run.trimmed(run.span) == Span(location: 10, length: 8))
  }

  @Test("A run is washed line by line, only on the lines it touches")
  func slices() {
    let lines = (0..<4).map { Span(location: $0 * 10, length: 10) }
    let span = Span(location: 15, length: 12)
    #expect(
      InsertionTrace.slices(of: span, lines: lines) == [
        Span(location: 15, length: 5), Span(location: 20, length: 7),
      ])
    // A run ending exactly at a line's end does not reach into the next line.
    #expect(
      InsertionTrace.slices(of: Span(location: 0, length: 10), lines: lines) == [
        Span(location: 0, length: 10)
      ])
    #expect(InsertionTrace.slices(of: Span(location: 50, length: 3), lines: lines).isEmpty)
  }

  @Test("A run over many lines keeps only the latest lines, next to the insertion point")
  func slicesLimit() {
    let lines = (0..<10).map { Span(location: $0 * 10, length: 10) }
    let parts = InsertionTrace.slices(of: Span(location: 0, length: 100), lines: lines)
    #expect(parts.count == InsertionTrace.maxWashLines)
    #expect(parts == Array(lines.suffix(InsertionTrace.maxWashLines)))
  }

  @Test("Rects some apps answer that are not text are rejected")
  func admitsRejectsJunk() {
    #expect(!InsertionTrace.admits(.null, within: nil))
    #expect(!InsertionTrace.admits(.infinite, within: nil))
    #expect(!InsertionTrace.admits(.zero, within: nil))
    // The zero origin some apps answer with a plausible size.
    #expect(!InsertionTrace.admits(CGRect(x: 0, y: 0, width: 8, height: 16), within: nil))
    // Too flat to be a line, or a block over several lines.
    #expect(!InsertionTrace.admits(CGRect(x: 10, y: 10, width: 8, height: 1), within: nil))
    let tallest = InsertionTrace.maxLineHeight
    #expect(InsertionTrace.admits(CGRect(x: 10, y: 10, width: 8, height: tallest), within: nil))
    #expect(
      !InsertionTrace.admits(CGRect(x: 10, y: 10, width: 8, height: tallest + 1), within: nil))
  }

  @Test("A line is taken on the field or within its slack, and any sane rect without a field")
  func admitsOnField() {
    let field = CGRect(x: 100, y: 100, width: 200, height: 50)
    let slack = InsertionTrace.fieldSlack
    #expect(InsertionTrace.admits(CGRect(x: 110, y: 110, width: 40, height: 16), within: field))
    // Glyphs drawn into the field's padding, just past its frame.
    let padded = CGRect(x: 110, y: field.maxY + slack - 2, width: 40, height: 16)
    #expect(InsertionTrace.admits(padded, within: field))
    let below = CGRect(x: 110, y: field.maxY + slack + 4, width: 40, height: 16)
    #expect(!InsertionTrace.admits(below, within: field))
    let aside = CGRect(x: field.maxX + slack + 4, y: 110, width: 40, height: 16)
    #expect(!InsertionTrace.admits(aside, within: field))
    // No frame to check against: a sane rect anywhere is taken.
    let far = CGRect(x: 900, y: 700, width: 40, height: 16)
    #expect(InsertionTrace.admits(far, within: nil))
    #expect(InsertionTrace.admits(far, within: CGRect(x: 100, y: 100, width: 0, height: 0)))
  }

  @Test("Bounds span lines only past one and a half line heights")
  func spansLines() {
    func bounds(_ height: CGFloat) -> CGRect { CGRect(x: 10, y: 10, width: 50, height: height) }
    #expect(!InsertionTrace.spansLines(bounds(16), lineHeight: 16))
    #expect(!InsertionTrace.spansLines(bounds(24), lineHeight: 16))
    #expect(InsertionTrace.spansLines(bounds(25), lineHeight: 16))
    #expect(InsertionTrace.spansLines(bounds(32), lineHeight: 16))
  }

  static let display = CGRect(x: 0, y: 0, width: 1000, height: 800)

  @Test("The overlay covers the field with a margin, clipped to the display")
  func coverageOnField() {
    let field = CGRect(x: 100, y: 100, width: 200, height: 50)
    let first = CGRect(x: 110, y: 110, width: 20, height: 16)
    #expect(
      InsertionTrace.coverage(field: field, first: first, display: Self.display, margin: 10)
        == CGRect(x: 90, y: 90, width: 220, height: 70))
    // A first rect in the field's padding widens the area to keep it.
    let padded = CGRect(x: 302, y: 110, width: 10, height: 16)
    #expect(
      InsertionTrace.coverage(field: field, first: padded, display: Self.display, margin: 10)
        == CGRect(x: 90, y: 90, width: 232, height: 70))
    // A field at the display's corner: the margin is cut off at the display's edge.
    let corner = CGRect(x: 4, y: 4, width: 200, height: 50)
    let inCorner = CGRect(x: 10, y: 10, width: 20, height: 16)
    #expect(
      InsertionTrace.coverage(field: corner, first: inCorner, display: Self.display, margin: 10)
        == CGRect(x: 0, y: 0, width: 214, height: 64))
  }

  @Test("Without a field the first rect lies on, the overlay covers the whole display")
  func coverageWholeDisplay() {
    let first = CGRect(x: 500, y: 500, width: 20, height: 16)
    let display = CGRect(x: 1000, y: -200, width: 800, height: 600)
    let onDisplay = CGRect(x: 1100, y: 0, width: 20, height: 16)
    #expect(
      InsertionTrace.coverage(field: nil, first: onDisplay, display: display, margin: 10)
        == display)
    let elsewhere = CGRect(x: 100, y: 100, width: 200, height: 50)
    #expect(
      InsertionTrace.coverage(field: elsewhere, first: first, display: Self.display, margin: 10)
        == Self.display)
    let empty = CGRect(x: 100, y: 100, width: 0, height: 0)
    #expect(
      InsertionTrace.coverage(field: empty, first: first, display: Self.display, margin: 10)
        == Self.display)
  }

  @Test("No overlay when the field is on another display")
  func coverageOffDisplay() {
    let field = CGRect(x: 2000, y: 100, width: 200, height: 50)
    let first = CGRect(x: 2010, y: 110, width: 20, height: 16)
    #expect(
      InsertionTrace.coverage(field: field, first: first, display: Self.display, margin: 10)
        == nil)
  }
}
