import AppKit

/// One paragraph of rendered Markdown before it is joined: its runs, the font its newline takes
/// (whose line height ends the paragraph: a heading's, a code block's, a rule's hairline), the
/// text blocks around it (outermost first) and its layout.
struct ResultTextParagraph {
  var text: NSAttributedString
  var font: NSFont
  var blocks: [NSTextBlock] = []
  var layout = ResultTextStyle.Layout()
}

extension ResultTextStyle {
  private struct Newline: Hashable {
    var font: NSFont
    /// A paragraph style outside text blocks, which the style cache keeps alive.
    var style: ObjectIdentifier
  }

  private static var newlines: [Newline: NSAttributedString] = [:]

  /// `paragraphs` joined by newlines, each in its paragraph style, and the newline that ends the
  /// last one where something follows it. A newline inside a paragraph (a line break, which
  /// keeps the answer's own lines) starts a line in the paragraph's style without the gap above
  /// it, aligned with its wrapped lines rather than its marker.
  func join(_ paragraphs: [ResultTextParagraph]) -> (
    text: NSAttributedString, separator: NSAttributedString
  ) {
    let result = NSMutableAttributedString()
    var separator = NSAttributedString(string: "\n", attributes: attributes)
    // Paragraphs in the same text block share one style and newline; the shared caches keep
    // only those outside blocks, which outlive any one text.
    var styles: [Layout: NSParagraphStyle] = [:]
    var newlines: [Newline: NSAttributedString] = [:]
    func style(_ layout: Layout, _ blocks: [NSTextBlock]) -> NSParagraphStyle {
      if let style = styles[layout] { return style }
      let style = paragraph(layout, blocks: blocks)
      styles[layout] = style
      return style
    }
    func newline(_ font: NSFont, _ style: NSParagraphStyle, shared: Bool) -> NSAttributedString {
      let key = Newline(font: font, style: ObjectIdentifier(style))
      if let newline = (shared ? Self.newlines[key] : newlines[key]) { return newline }
      let newline = NSAttributedString(
        string: "\n",
        attributes: [.font: font, .foregroundColor: Self.text, .paragraphStyle: style])
      if shared { Self.newlines[key] = newline } else { newlines[key] = newline }
      return newline
    }
    for (index, paragraph) in paragraphs.enumerated() {
      let start = result.length
      result.append(paragraph.text)
      let paragraphStyle = style(paragraph.layout, paragraph.blocks)
      let newline = newline(paragraph.font, paragraphStyle, shared: paragraph.blocks.isEmpty)
      if index < paragraphs.count - 1 { result.append(newline) } else { separator = newline }
      result.addAttribute(
        .paragraphStyle, value: paragraphStyle, range: NSRange(start..<result.length))
      let inner = (paragraph.text.string as NSString).range(of: "\n")
      guard inner.location != NSNotFound else { continue }
      var continued = paragraph.layout
      continued.gap = 0
      continued.firstIndent = continued.indent
      let from = start + inner.location + 1
      result.addAttribute(
        .paragraphStyle, value: style(continued, paragraph.blocks),
        range: NSRange(from..<result.length))
    }
    return (result, separator)
  }

  /// Appends `suffix` (an answer's "Stopped") in the secondary colour: after the last line, in
  /// its paragraph, or under it where that paragraph is in a text block (a code block, a quote, a
  /// table), which keeps its own lines.
  func append(suffix: String, to text: NSMutableAttributedString) {
    var attributes = attributes
    attributes[.foregroundColor] = Self.secondary
    guard text.length > 0 else {
      text.append(NSAttributedString(string: suffix, attributes: attributes))
      return
    }
    let last = text.attributes(at: text.length - 1, effectiveRange: nil)
    let style = last[.paragraphStyle] as? NSParagraphStyle
    if let style, !style.textBlocks.isEmpty {
      text.append(NSAttributedString(string: "\n", attributes: last))
      attributes[.paragraphStyle] = paragraph(Layout(gap: Self.blockGap))
      text.append(NSAttributedString(string: suffix, attributes: attributes))
    } else {
      if let style { attributes[.paragraphStyle] = style }
      text.append(NSAttributedString(string: " " + suffix, attributes: attributes))
    }
  }
}
