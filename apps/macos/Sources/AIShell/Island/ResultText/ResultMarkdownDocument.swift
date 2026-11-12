import AppKit
import Markdown

/// A Markdown text rendered as result text, kept by top-level block so an answer streaming in
/// renders only what changed. CommonMark closes a top-level block for good once the next one
/// starts, so only the last can change as text is appended: a text that extends a rendered one
/// keeps that one's blocks before its last, and parses and renders again only from the line its
/// last block starts on. (A link reference definition streaming in after a settled block that
/// uses it is the one thing this misses; that block keeps its literal brackets.)
final class ResultMarkdownDocument {
  let source: String
  let style: ResultTextStyle
  /// The rendered text: the blocks' paragraphs joined.
  let text: NSAttributedString
  private let segments: [Segment]

  /// The source a text renders as Markdown, in UTF-8 bytes: the blocks that start within it
  /// render, and from the block it falls in on the text shows as written, as it streams in too.
  /// Laying out that much text takes frames already, and Markdown would add half again (with
  /// its parse and render); a result card scrolls past the first few thousand characters anyway.
  static let limit = 32 * 1024

  /// A top-level block, rendered, or the plain text past ``limit``.
  private struct Segment {
    /// Where its source starts, in UTF-8 bytes from the document's start; always a line start.
    var start: Int
    var text: NSAttributedString
    /// The newline after it where another block follows, in its last paragraph's style.
    var separator: NSAttributedString
    /// It rendered no paragraph (an empty code block, a rule closing the text): it takes no
    /// place, and no newline.
    var isEmpty: Bool
    var isHeading = false
    var isPlain = false
    var blocks = ResultTextBlocks()
  }

  /// Renders `source`, reusing what `previous` rendered of the text it starts with.
  init(source: String, style: ResultTextStyle, after previous: ResultMarkdownDocument?) {
    self.source = source
    self.style = style
    let bytes = Array(source.utf8)
    var segments: [Segment] = []
    var from = 0
    var reuse: ResultTextBlocks?
    var plain: Int?
    if let previous, previous.style == style, let last = previous.segments.last,
      source.utf8.starts(with: previous.source.utf8)
    {
      segments = Array(previous.segments.dropLast())
      from = last.start
      reuse = last.blocks
      if last.isPlain { plain = from }
    }
    if plain == nil {
      let end = bytes.count > Self.limit ? Self.lineEnd(at: Self.limit, in: bytes) : bytes.count
      let tail = String(decoding: bytes[min(from, end)..<end], as: UTF8.self)
      let document = Document(parsing: tail, options: [.disableSmartOpts])
      let lines = Self.lineStarts(tail)
      let count = document.childCount
      if from >= end { plain = from }
      for (index, child) in document.children.enumerated() {
        let line = child.range.map { min($0.lowerBound.line - 1, lines.count - 1) } ?? 0
        let start = from + lines[line]
        // The block the limit falls in (the last parsed, up to the end of the limit's line) shows
        // plain, with the rest: wherever the text stood when it crossed the limit, the same one.
        if end < bytes.count, index == count - 1 {
          plain = start
          break
        }
        let previousHeading = segments.last(where: { !$0.isEmpty })?.isHeading
        let gap =
          previousHeading.map { ResultMarkdownRenderer.gap(afterHeading: $0, before: child) } ?? 0
        let blocks = index == 0 ? reuse ?? ResultTextBlocks() : ResultTextBlocks()
        var renderer = ResultMarkdownRenderer(style: style, blocks: blocks)
        renderer.block(child, in: .init(), gap: gap)
        var paragraphs = renderer.paragraphs
        // The text's end holds no empty paragraph: no newline follows to draw it with.
        if index == count - 1 {
          while paragraphs.last?.text.length == 0 { paragraphs.removeLast() }
        }
        let joined = style.join(paragraphs)
        segments.append(
          Segment(
            start: start, text: joined.text, separator: joined.separator,
            isEmpty: paragraphs.isEmpty, isHeading: child is Heading, blocks: blocks))
      }
      if end < bytes.count, plain == nil { plain = end }
    }
    if let plain {
      let text = style.plain(String(decoding: bytes[plain...], as: UTF8.self))
      segments.append(
        Segment(
          start: plain, text: text, separator: style.plain("\n"), isEmpty: text.length == 0,
          isPlain: true))
    }
    self.segments = segments
    let text = NSMutableAttributedString()
    var separator: NSAttributedString?
    for segment in segments where !segment.isEmpty {
      if let separator { text.append(separator) }
      text.append(segment.text)
      separator = segment.separator
    }
    self.text = text
  }

  /// Where the line the byte at `offset` is on ends, past its line feed.
  private static func lineEnd(at offset: Int, in bytes: [UInt8]) -> Int {
    var index = offset
    while index < bytes.count, bytes[index] != UInt8(ascii: "\n") { index += 1 }
    return min(index + 1, bytes.count)
  }

  /// The UTF-8 offset each line of `text` starts at; a line ends at a line feed, a carriage
  /// return, or both, as CommonMark's do.
  private static func lineStarts(_ text: String) -> [Int] {
    var starts = [0]
    let bytes = Array(text.utf8)
    var index = 0
    while index < bytes.count {
      let byte = bytes[index]
      index += 1
      if byte == UInt8(ascii: "\r"), index < bytes.count, bytes[index] == UInt8(ascii: "\n") {
        index += 1
      }
      if byte == UInt8(ascii: "\n") || byte == UInt8(ascii: "\r") { starts.append(index) }
    }
    return starts
  }
}
