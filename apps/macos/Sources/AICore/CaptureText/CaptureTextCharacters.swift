import CoreGraphics
import Foundation

/// A place between two characters of a screenshot's recognized text: before character `offset`
/// of paragraph `paragraph`'s ``CaptureTextParagraph/text`` (its length is after the last), in
/// one ``CaptureTextLayout``. Carets order as the text reads: by paragraph, then offset.
public struct CaptureTextCaret: Comparable, Hashable, Sendable {
  public let paragraph: Int
  public let offset: Int

  public init(paragraph: Int, offset: Int) {
    self.paragraph = paragraph
    self.offset = offset
  }

  public static func < (lhs: Self, rhs: Self) -> Bool {
    (lhs.paragraph, lhs.offset) < (rhs.paragraph, rhs.offset)
  }
}

/// Characters selected by dragging over a screenshot's text in text mode (or a word picked with
/// a double-click): from where the drag began (``anchor``) to where it is (``focus``), in reading
/// order across paragraphs. A paragraph a mosaic touches gives none of its characters to the copy,
/// the command or the highlight (decision D6), whichever way the range runs over it.
public struct CaptureTextCharacters: Equatable, Sendable {
  public var anchor: CaptureTextCaret
  public var focus: CaptureTextCaret

  public init(anchor: CaptureTextCaret, focus: CaptureTextCaret) {
    self.anchor = anchor
    self.focus = focus
  }

  public var lower: CaptureTextCaret { min(anchor, focus) }
  public var upper: CaptureTextCaret { max(anchor, focus) }
  public var isEmpty: Bool { anchor == focus }

  /// The selected characters of each paragraph the range spans and `available` holds, in reading
  /// order, as offsets into its text; paragraphs it selects nothing of are left out.
  public func parts(in layout: CaptureTextLayout, available: Set<Int>) -> [(
    paragraph: Int, range: Range<Int>
  )] {
    let (lower, upper) = (self.lower, self.upper)
    guard lower.paragraph <= upper.paragraph else { return [] }
    return (lower.paragraph...upper.paragraph).compactMap { index in
      guard layout.indices.contains(index), available.contains(index) else { return nil }
      let count = layout[index].text.count
      let start = index == lower.paragraph ? min(max(lower.offset, 0), count) : 0
      let end = index == upper.paragraph ? min(max(upper.offset, 0), count) : count
      return start < end ? (index, start..<end) : nil
    }
  }

  /// The paragraphs it selects any character of, among `available`, in reading order: what a
  /// command run on the selected characters reads, whole.
  public func paragraphs(in layout: CaptureTextLayout, available: Set<Int>) -> [Int] {
    parts(in: layout, available: available).map(\.paragraph)
  }

  /// The selected text, a blank line between paragraphs; empty when it selects nothing available.
  public func text(in layout: CaptureTextLayout, available: Set<Int>) -> String {
    parts(in: layout, available: available).map { part in
      let characters = Array(layout[part.paragraph].text)
      return String(characters[part.range])
    }
    .joined(separator: "\n\n")
  }

  /// The boxes that show it: on each line it covers, from the caret before its first selected
  /// character to the caret after its last (``CaptureTextGlyphs/carets(for:)``).
  public func rects(
    in layout: CaptureTextLayout, glyphs: CaptureTextGlyphs, available: Set<Int>
  ) -> [CGRect] {
    parts(in: layout, available: available).flatMap { part in
      layout[part.paragraph].lines.compactMap { line -> CGRect? in
        let start = max(part.range.lowerBound, line.range.lowerBound)
        let end = min(part.range.upperBound, line.range.upperBound)
        guard start < end else { return nil }
        let carets = glyphs.carets(for: line)
        let from = carets[start - line.range.lowerBound]
        let to = carets[end - line.range.lowerBound]
        return CGRect(x: from, y: line.box.minY, width: max(to - from, 1), height: line.box.height)
      }
    }
  }
}

extension CaptureTextLayout {
  /// The caret nearest `point` in the paragraphs `available` holds: on the line nearest it (one
  /// it lies within vertically first, then across), at the edge between characters nearest it
  /// across. Nil without any such line.
  public func caret(
    at point: CGPoint, glyphs: CaptureTextGlyphs, available: Set<Int>
  ) -> CaptureTextCaret? {
    var best: (paragraph: Int, line: CaptureTextParagraph.Line, distance: (CGFloat, CGFloat))?
    for index in indices where available.contains(index) {
      for line in self[index].lines {
        let box = line.box
        let distance = (
          max(box.minY - point.y, 0, point.y - box.maxY),
          max(box.minX - point.x, 0, point.x - box.maxX)
        )
        if best.map({ distance < $0.distance }) ?? true { best = (index, line, distance) }
      }
    }
    guard let best else { return nil }
    let carets = glyphs.carets(for: best.line)
    let nearest = carets.indices.min { abs(carets[$0] - point.x) < abs(carets[$1] - point.x) } ?? 0
    return CaptureTextCaret(paragraph: best.paragraph, offset: best.line.range.lowerBound + nearest)
  }

  /// The line of paragraph `index` whose box holds `point`, a couple of points of slack around
  /// it: where a press reads as a press on the text itself rather than beside it.
  public func line(at point: CGPoint, in index: Int, slack: CGFloat = 2) -> Int? {
    guard indices.contains(index) else { return nil }
    return self[index].lines.firstIndex { line in
      line.box.insetBy(dx: -slack, dy: -slack).contains(point)
    }
  }
}
