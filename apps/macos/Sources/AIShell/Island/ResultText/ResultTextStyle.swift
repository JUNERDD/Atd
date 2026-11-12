import AppKit

/// The result cards' type in AppKit terms: the answer type (``IslandType/answer``, the 13 pt
/// system font in the label colour) and what Markdown derives from it. Colours are the system's
/// dynamic colours, which the text view resolves in its own appearance as it draws, so a scheme
/// change needs no new text. Fonts and paragraph styles come from caches: a render asks for the
/// same few again and again.
struct ResultTextStyle: Hashable {
  /// Points between the lines of a paragraph: none in the answer card, 4 in a shell card's
  /// answer, as their SwiftUI text had.
  var lineSpacing: CGFloat = 0

  static let size: CGFloat = 13
  /// Inline code and code blocks, a point under the text around them.
  static let codeSize: CGFloat = 12
  /// Above a block (a paragraph, list, code block, quote, table or rule) after another.
  static let blockGap: CGFloat = 8
  /// Above a heading after another block, and under a heading.
  static let headingGap: CGFloat = 12
  static let afterHeadingGap: CGFloat = 4
  /// Between a list's items, and above a list nested in an item.
  static let itemGap: CGFloat = 3
  /// Between an item's paragraphs.
  static let itemParagraphGap: CGFloat = 6

  // Nonisolated: TextKit draws its blocks and fills (``ResultTextBlock``, ``ResultLayoutManager``)
  // outside the main actor's isolation, though on the main thread.
  nonisolated static let text = NSColor.labelColor
  nonisolated static let secondary = NSColor.secondaryLabelColor
  nonisolated static let link = NSColor.controlAccentColor
  /// Inline code's fill (rounded by ``ResultLayoutManager``), code blocks' and table headers'.
  nonisolated static let codeFill = NSColor.quaternarySystemFill
  nonisolated static let rule = NSColor.separatorColor
  nonisolated static let quoteBar = NSColor.tertiaryLabelColor

  /// The body font.
  var font: NSFont { Self.font(size: Self.size) }

  /// The base attributes of a paragraph of body text.
  var attributes: [NSAttributedString.Key: Any] {
    [.font: font, .foregroundColor: Self.text, .paragraphStyle: paragraph(.init())]
  }

  /// `text` as it is, in the answer type: what a card shows with Markdown off.
  func plain(_ text: String) -> NSAttributedString {
    NSAttributedString(string: text, attributes: attributes)
  }

  // MARK: Fonts

  private struct FontKey: Hashable {
    var size: CGFloat
    var weight: CGFloat
    var italic: Bool
    var monospaced: Bool
  }

  private static var fonts: [FontKey: NSFont] = [:]

  static func font(
    size: CGFloat, weight: NSFont.Weight = .regular, italic: Bool = false,
    monospaced: Bool = false
  ) -> NSFont {
    let key = FontKey(size: size, weight: weight.rawValue, italic: italic, monospaced: monospaced)
    if let font = fonts[key] { return font }
    var font =
      monospaced
      ? NSFont.monospacedSystemFont(ofSize: size, weight: weight)
      : NSFont.systemFont(ofSize: size, weight: weight)
    if italic {
      let descriptor = font.fontDescriptor.withSymbolicTraits(
        font.fontDescriptor.symbolicTraits.union(.italic))
      font = NSFont(descriptor: descriptor, size: size) ?? font
    }
    fonts[key] = font
    return font
  }

  // MARK: Paragraph styles

  /// What sets a paragraph's style apart: its indents and tab stops (a list item's marker
  /// column), alignment (a table cell's), the space above it, and the text blocks around it
  /// (outermost first), compared by identity as TextKit does.
  struct Layout: Hashable {
    var firstIndent: CGFloat = 0
    var indent: CGFloat = 0
    /// Tab stops: a positive location is left-aligned, a negative one right-aligned at its
    /// magnitude (an ordered list's numbers end there).
    var tabs: [CGFloat] = []
    var alignment = NSTextAlignment.natural
    var gap: CGFloat = 0
    var blocks: [ObjectIdentifier] = []
  }

  private struct StyleKey: Hashable {
    var lineSpacing: CGFloat
    var layout: Layout
  }

  private static var styles: [StyleKey: NSParagraphStyle] = [:]

  /// The paragraph style for `layout` inside `blocks` (the blocks `layout.blocks` names).
  func paragraph(_ layout: Layout, blocks: [NSTextBlock] = []) -> NSParagraphStyle {
    let key = StyleKey(lineSpacing: lineSpacing, layout: layout)
    if let style = Self.styles[key] { return style }
    let style = NSMutableParagraphStyle()
    style.lineSpacing = lineSpacing
    style.paragraphSpacingBefore = layout.gap
    style.firstLineHeadIndent = layout.firstIndent
    style.headIndent = layout.indent
    style.alignment = layout.alignment
    style.textBlocks = blocks
    if !layout.tabs.isEmpty {
      style.tabStops = layout.tabs.map {
        NSTextTab(textAlignment: $0 < 0 ? .right : .left, location: abs($0))
      }
    }
    // Styles inside text blocks name blocks that live only as long as their text; keep only the
    // block-free ones, which every render shares.
    if layout.blocks.isEmpty { Self.styles[key] = style }
    return style
  }
}
