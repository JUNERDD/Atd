import AppKit
import Markdown

/// Renders one top-level Markdown block as result text paragraphs (``ResultMarkdownDocument``
/// joins them): headings by weight, kept compact; lists with hanging indents, their markers in a
/// column of their own; task items with a box; quotes indented past a bar, in the secondary
/// colour; code in the code font on a rounded fill; tables in TextKit tables; rules as a
/// hairline; HTML as written.
struct ResultMarkdownRenderer {
  let style: ResultTextStyle
  let blocks: ResultTextBlocks
  private(set) var paragraphs: [ResultTextParagraph] = []
  /// A list item's marker, waiting for the item's first paragraph.
  private var marker: Marker?

  /// Where a block sits: the text blocks around it (outermost first), its indent inside the
  /// innermost, whether it is quoted, and how deep in lists.
  struct Scope {
    var blocks: [NSTextBlock] = []
    var indent: CGFloat = 0
    var quoted = false
    var depth = 0
    var inItem = false

    var color: NSColor { quoted ? ResultTextStyle.secondary : ResultTextStyle.text }
  }

  private struct Marker {
    /// The marker and the tabs around it: `•⇥` or, right-aligned, `⇥12.⇥`.
    var text: NSAttributedString
    var firstIndent: CGFloat
    var tabs: [CGFloat]
  }

  init(style: ResultTextStyle, blocks: ResultTextBlocks) {
    self.style = style
    self.blocks = blocks
    blocks.begin()
  }

  /// The space above `next` after a heading (`afterHeading`) or another block, at the top level
  /// or in a list item.
  static func gap(afterHeading: Bool, before next: Markup, inItem: Bool = false) -> CGFloat {
    if next is Heading { return ResultTextStyle.headingGap }
    if afterHeading { return ResultTextStyle.afterHeadingGap }
    if inItem {
      return next is ListItemContainer ? ResultTextStyle.itemGap : ResultTextStyle.itemParagraphGap
    }
    return ResultTextStyle.blockGap
  }

  mutating func block(_ markup: Markup, in scope: Scope, gap: CGFloat) {
    switch markup {
    case let paragraph as Paragraph:
      let traits = ResultMarkdownInlines.Traits(color: scope.color)
      emit(
        ResultMarkdownInlines.render(paragraph, traits: traits), font: style.font, in: scope,
        gap: gap)
    case let heading as Heading:
      let size: CGFloat = heading.level == 1 ? 15 : heading.level == 2 ? 14 : 13
      let traits = ResultMarkdownInlines.Traits(size: size, weight: .semibold, color: scope.color)
      emit(
        ResultMarkdownInlines.render(heading, traits: traits),
        font: ResultTextStyle.font(size: size, weight: .semibold), in: scope, gap: gap)
    case let quote as BlockQuote:
      let gap = markerAlone(in: scope, gap: gap)
      let block = blocks.block(kind: .drawn(.quote), indent: scope.indent, gap: gap) {
        ResultTextBlock.make(.quote, indent: scope.indent, gap: gap)
      }
      let inner = Scope(blocks: scope.blocks + [block], quoted: true, depth: scope.depth)
      children(of: quote, in: inner, gap: 0)
    case let code as CodeBlock:
      self.code(code.code, in: scope, gap: gap)
    case let list as OrderedList:
      self.list(Array(list.listItems), start: Int(list.startIndex), in: scope, gap: gap)
    case let list as UnorderedList:
      self.list(Array(list.listItems), start: nil, in: scope, gap: gap)
    case let table as Markdown.Table:
      self.table(table, in: scope, gap: markerAlone(in: scope, gap: gap))
    case is ThematicBreak:
      let gap = markerAlone(in: scope, gap: gap)
      let block = blocks.block(kind: .drawn(.rule), indent: scope.indent, gap: gap) {
        ResultTextBlock.make(.rule, indent: scope.indent, gap: gap)
      }
      var inner = scope
      inner.blocks.append(block)
      inner.indent = 0
      emit(NSAttributedString(), font: ResultTextStyle.font(size: 1), in: inner, gap: 0)
    case let html as HTMLBlock:
      let text = html.rawHTML.trimmingCharacters(in: .newlines)
      let traits = ResultMarkdownInlines.Traits(color: scope.color)
      emit(ResultMarkdownInlines.run(text, traits), font: style.font, in: scope, gap: gap)
    default:
      children(of: markup, in: scope, gap: gap)
    }
  }

  private mutating func children(of parent: Markup, in scope: Scope, gap: CGFloat) {
    var previous: Markup?
    for child in parent.children {
      let gap =
        previous.map {
          Self.gap(afterHeading: $0 is Heading, before: child, inItem: scope.inItem)
        } ?? gap
      block(child, in: scope, gap: gap)
      previous = child
    }
  }

  private mutating func code(_ source: String, in scope: Scope, gap: CGFloat) {
    var lines = source.split(separator: "\n", omittingEmptySubsequences: false)
    while lines.last?.isEmpty == true { lines.removeLast() }
    guard !lines.isEmpty else { return }
    let gap = markerAlone(in: scope, gap: gap)
    let block = blocks.block(kind: .drawn(.code), indent: scope.indent, gap: gap) {
      ResultTextBlock.make(.code, indent: scope.indent, gap: gap)
    }
    var inner = scope
    inner.blocks.append(block)
    inner.indent = 0
    let traits = ResultMarkdownInlines.Traits(code: true, block: true, color: scope.color)
    let font = ResultTextStyle.font(size: ResultTextStyle.codeSize, monospaced: true)
    // One paragraph whose lines continue it: the block's lines share its style.
    emit(
      ResultMarkdownInlines.run(lines.joined(separator: "\n"), traits), font: font, in: inner,
      gap: 0)
  }

  private mutating func list(_ items: [ListItem], start: Int?, in scope: Scope, gap: CGFloat) {
    let tasks = items.contains { $0.checkbox != nil }
    let traits = ResultMarkdownInlines.Traits(digits: true, color: ResultTextStyle.secondary)
    let textStart: CGFloat
    let numberEnd: CGFloat
    if let start {
      // The widest number is the last: the digits are all as wide.
      let widest = ResultMarkdownInlines.run("\(start + items.count - 1).", traits)
      numberEnd = scope.indent + ceil(widest.size().width)
      textStart = numberEnd + (tasks ? 22 : 5)
    } else {
      numberEnd = 0
      textStart = scope.indent + (tasks ? 20 : 16)
    }
    for (index, item) in items.enumerated() {
      let number = start.map { "\t\($0 + index)." }
      let box = item.checkbox.map { $0 == .checked ? "☑" : "☐" }
      let label =
        switch (number, box) {
        case (let number?, let box?): number + "\u{2002}" + box + "\t"
        case (let number?, nil): number + "\t"
        case (nil, let box?): box + "\t"
        case (nil, nil): Self.bullet(scope.depth) + "\t"
        }
      marker = Marker(
        text: ResultMarkdownInlines.run(label, traits),
        firstIndent: start == nil ? scope.indent + 3 : scope.indent,
        tabs: start == nil ? [textStart] : [-numberEnd, textStart])
      var inner = scope
      inner.indent = textStart
      inner.depth += 1
      inner.inItem = true
      let itemGap = index == 0 ? gap : ResultTextStyle.itemGap
      children(of: item, in: inner, gap: itemGap)
      // An item with nothing in it yet (one streaming in) still shows its marker.
      if marker != nil { emit(NSAttributedString(), font: style.font, in: inner, gap: itemGap) }
    }
  }

  private static func bullet(_ depth: Int) -> String {
    switch depth {
    case 0: "•"
    case 1: "◦"
    default: "▪"
    }
  }

  /// Puts a waiting marker on a line of its own, for an item that starts with a block that
  /// takes no marker (a code block, a quote, a table, a rule); the block then follows it without
  /// a gap. Returns the gap the block takes.
  private mutating func markerAlone(in scope: Scope, gap: CGFloat) -> CGFloat {
    guard marker != nil else { return gap }
    emit(NSAttributedString(), font: style.font, in: scope, gap: gap)
    return 0
  }

  mutating func emit(
    _ text: NSAttributedString, font: NSFont, in scope: Scope, gap: CGFloat,
    alignment: NSTextAlignment = .natural
  ) {
    var layout = ResultTextStyle.Layout(
      firstIndent: scope.indent, indent: scope.indent, alignment: alignment, gap: gap,
      blocks: scope.blocks.map(ObjectIdentifier.init))
    var content = text
    if let marker {
      self.marker = nil
      let line = NSMutableAttributedString(attributedString: marker.text)
      line.append(text)
      content = line
      layout.firstIndent = marker.firstIndent
      layout.tabs = marker.tabs
    }
    paragraphs.append(
      ResultTextParagraph(text: content, font: font, blocks: scope.blocks, layout: layout))
  }
}
