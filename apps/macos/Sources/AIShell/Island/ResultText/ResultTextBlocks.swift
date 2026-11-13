import AppKit

/// A text block the result text draws itself (TextKit 1): a code block's rounded fill, a quote's
/// bar, a thematic break's hairline. Its margins place it (the indent of the list it is in, the
/// gap above it) and its padding insets its text; the drawing keeps inside the margins.
nonisolated final class ResultTextBlock: NSTextBlock {
  enum Kind: Int { case code, quote, rule }

  /// Plain data only: AppKit may copy a block bit for bit.
  var kind = Kind.code

  static let quoteBar: CGFloat = 2
  static let quoteInset: CGFloat = 10
  static let codeRadius: CGFloat = 6

  /// A block of `kind`, `indent` points in from its container's leading edge and `gap` points
  /// below what precedes it.
  static func make(_ kind: Kind, indent: CGFloat, gap: CGFloat) -> ResultTextBlock {
    let block = ResultTextBlock()
    block.kind = kind
    // Without a width a block shrinks around its first paragraph and lets the next escape it.
    block.setContentWidth(100, type: .percentageValueType)
    block.setWidth(indent, type: .absoluteValueType, for: .margin, edge: .minX)
    block.setWidth(gap, type: .absoluteValueType, for: .margin, edge: .minY)
    switch kind {
    case .code:
      block.setWidth(8, type: .absoluteValueType, for: .padding, edge: .minX)
      block.setWidth(8, type: .absoluteValueType, for: .padding, edge: .maxX)
      block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .minY)
      block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .maxY)
    case .quote:
      block.setWidth(quoteInset, type: .absoluteValueType, for: .padding, edge: .minX)
    case .rule:
      block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .minY)
      block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .maxY)
    }
    return block
  }

  override func copy(with zone: NSZone? = nil) -> Any {
    let copy = super.copy(with: zone)
    (copy as? ResultTextBlock)?.kind = kind
    return copy
  }

  override func drawBackground(
    withFrame frameRect: NSRect, in controlView: NSView, characterRange charRange: NSRange,
    layoutManager: NSLayoutManager
  ) {
    let box = NSRect(
      x: frameRect.minX + width(for: .margin, edge: .minX),
      y: frameRect.minY + width(for: .margin, edge: .minY),
      width: frameRect.width - width(for: .margin, edge: .minX)
        - width(for: .margin, edge: .maxX),
      height: frameRect.height - width(for: .margin, edge: .minY)
        - width(for: .margin, edge: .maxY))
    guard box.width > 0, box.height > 0 else { return }
    switch kind {
    case .code:
      ResultTextStyle.codeFill.setFill()
      NSBezierPath(roundedRect: box, xRadius: Self.codeRadius, yRadius: Self.codeRadius).fill()
    case .quote:
      ResultTextStyle.quoteBar.setFill()
      let bar = NSRect(x: box.minX, y: box.minY, width: Self.quoteBar, height: box.height)
      NSBezierPath(roundedRect: bar, xRadius: 1, yRadius: 1).fill()
    case .rule:
      ResultTextStyle.rule.setFill()
      // One device pixel, as AppKit's separators are.
      let device = NSGraphicsContext.current?.cgContext.convertToDeviceSpace(
        CGSize(width: 1, height: 1))
      let pixel = 1 / max(abs(device?.height ?? 2), 1)
      NSRect(x: box.minX, y: box.midY.rounded(.down), width: box.width, height: pixel).fill()
    }
  }
}

/// The blocks a top-level Markdown block's renders share: the same block for the same place
/// from one render to the next, so text that did not change keeps equal attributes (TextKit and
/// the attribute diff compare blocks by identity) and a block that grows as the answer streams
/// stays one box, with any selection in it.
final class ResultTextBlocks {
  /// What a block is for: one of ``ResultTextBlock``'s kinds, a table or a table's cell.
  enum Kind: Hashable {
    case drawn(ResultTextBlock.Kind)
    case table, cell
  }

  struct Key: Hashable {
    var kind: Kind
    /// The block's place among the blocks of its kind in the top-level block.
    var ordinal: Int
    var indent: CGFloat
    var gap: CGFloat
    /// A table's columns, a cell's row, column and spans.
    var shape: [Int] = []
  }

  private var blocks: [Key: NSTextBlock] = [:]
  private var counts: [Kind: Int] = [:]

  /// Starts a render: ordinals count from zero again.
  func begin() { counts = [:] }

  /// The next block of `kind`, the one made for the same place before when it had the same
  /// placement.
  func block<Block: NSTextBlock>(
    kind: Kind, indent: CGFloat, gap: CGFloat, shape: [Int] = [], make: () -> Block
  ) -> Block {
    next(kind: kind, indent: indent, gap: gap, shape: shape, make: make).block
  }

  /// ``block(kind:indent:gap:shape:make:)`` with its ordinal, which a table's cells key on.
  func next<Block: NSTextBlock>(
    kind: Kind, indent: CGFloat, gap: CGFloat, shape: [Int] = [], make: () -> Block
  ) -> (block: Block, ordinal: Int) {
    let ordinal = counts[kind, default: 0]
    counts[kind] = ordinal + 1
    let key = Key(kind: kind, ordinal: ordinal, indent: indent, gap: gap, shape: shape)
    if let block = blocks[key] as? Block { return (block, ordinal) }
    let block = make()
    blocks[key] = block
    return (block, ordinal)
  }

  /// A cell of `table`, keyed by its place in it; a table of another shape is another block
  /// (its key names its columns), whose cells are new too.
  func cell(
    of table: NSTextTable, ordinal tableOrdinal: Int, row: Int, column: Int, rows: Int,
    columns: Int, make: () -> NSTextTableBlock
  ) -> NSTextTableBlock {
    let key = Key(
      kind: .cell, ordinal: tableOrdinal, indent: 0, gap: 0, shape: [row, column, rows, columns])
    if let block = blocks[key] as? NSTextTableBlock, block.table === table { return block }
    let block = make()
    blocks[key] = block
    return block
  }
}
