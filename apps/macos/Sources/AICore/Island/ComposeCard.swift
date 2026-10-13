/// What the compose card holds while a command launched with nothing selected waits for its text
/// (the `compose` phase): the text typed in place of the selection, the files the shell attached
/// for it (screenshots and picked files, already imported as resources), and a short note about
/// the last attachment that did not go as asked. It is the card's own: the page learns it only
/// when the card runs or opens (``input``).
public struct ComposeDraft: Equatable, Sendable {
  /// Why the last attachment did not go as asked, shown in place of the card's note.
  public enum Note: Equatable, Sendable {
    /// Some files were left out: the card holds at most ``ComposeDraft/maxFiles``.
    case limit
    /// The screenshot was refused: Screen Recording is not allowed.
    case screenRecording
    /// The attachment failed, in the shell's words.
    case failed(String)
  }

  /// The most files the card holds, the contract's limit (`ComposedInputSchema`).
  public static let maxFiles = 10

  /// The text as typed, untrimmed.
  public var text = ""
  /// The attached files in the order they were added.
  public private(set) var files: [FileRef] = []
  public var note: Note?

  public init(text: String = "", files: [FileRef] = []) {
    self.text = text
    self.files = Array(files.prefix(Self.maxFiles))
  }

  /// The card can run (or open) with something: text that is not only white space, or a file.
  public var canRun: Bool {
    !files.isEmpty || !text.allSatisfy(\.isWhitespace)
  }

  /// Adds `added` after the files already attached, up to ``maxFiles``; the rest are left out
  /// and the note says so. Clears an earlier note otherwise.
  public mutating func attach(_ added: [FileRef]) {
    let room = max(Self.maxFiles - files.count, 0)
    files += added.prefix(room)
    note = added.count > room ? .limit : nil
  }

  /// Takes away the file at `index`, and the note about an earlier attachment with it.
  public mutating func remove(at index: Int) {
    guard files.indices.contains(index) else { return }
    files.remove(at: index)
    note = nil
  }

  /// What the card hands the page with Run or Open: the text as typed and the files in order.
  public var input: CommandProgressActionEvent.Compose {
    CommandProgressActionEvent.Compose(text: text, files: files)
  }
}

/// The compose card's geometry. It shares the options and answer cards' corner, padding, title
/// row and footer (``IslandMetrics/cardRadius``, ``IslandMetrics/cardPadding``,
/// ``IslandMetrics/headerHeight``, ``IslandMetrics/footerHeight``). Between title and footer: the
/// note (the answer card's, wrapping to ``IslandMetrics/maxNoteLines``), the text field, which
/// grows a line at a time up to ``composeMaxLines`` and scrolls inside past them, and, once a file
/// is attached, one row of attachment chips that scrolls sideways (``ComposeChipRow``).
extension IslandMetrics {
  /// The card is at least this wide, so the field has room to write in.
  public static let composeMinWidth = 400.0
  /// The field grows to this many lines, then scrolls.
  public static let composeMaxLines = 6
  /// Above and below the field's text, inside its wash.
  public static let composeFieldInset = 6.0
  /// An attachment chip's height, and so its row's.
  public static let composeChipHeight = 28.0
  /// The field's and the chips' corner: concentric with the card's, ``cardPadding`` inside it.
  public static var composeRadius: Double { cardRadius - cardPadding }

  /// The card's width for a title and footer that would take `ideal` points.
  public static func composeCardWidth(ideal: Double) -> Double {
    cardWidth(ideal: max(ideal, composeMinWidth))
  }

  /// The field's height for text that wraps to `lines` lines of `lineHeight` points: one line at
  /// the least and ``composeMaxLines`` at the most.
  public static func composeFieldHeight(lines: Int, lineHeight: Double) -> Double {
    let shown = Double(min(max(lines, 1), composeMaxLines))
    return (shown * lineHeight + composeFieldInset * 2).rounded(.up)
  }

  /// The card's height under a note `note` points tall, with a field `field` points tall and the
  /// chips' row when `chips`: everything shown, up to ``maxShape``'s height.
  public static func composeCardHeight(note: Double, field: Double, chips: Bool) -> Double {
    let body = note + noteGap + sectionGap + field + (chips ? sectionGap + composeChipHeight : 0)
    let total = cardPadding * 2 + headerHeight + body + sectionGap + footerHeight
    return min(total.rounded(.up), maxShape.height)
  }
}

/// The compose card's row of attachment chips, as its scroll arrows read it: chips `widths`
/// points wide, ``gap`` apart, after `margin` points of the row's own inset and before as many
/// again. Each edge of the row keeps ``clear`` points under its fade and arrow; an arrow scrolls
/// so the chip it cut lands wholly past that, at the far edge for the trailing arrow and at the
/// near edge for the leading one, which moves the row by about the width it shows.
public struct ComposeChipRow: Equatable, Sendable {
  /// Which chip each edge cuts, at the offset the scroll view has now: the reduced reading its
  /// scroll geometry changes to, so the row updates only when a chip crosses an edge.
  public struct Cut: Equatable, Sendable {
    /// The last chip not wholly clear of the leading edge, when the row is scrolled past one.
    public var leading: Int?
    /// The first chip not wholly clear of the trailing edge.
    public var trailing: Int?
    /// The scroll view's width.
    public var container = 0.0

    public init(leading: Int? = nil, trailing: Int? = nil, container: Double = 0) {
      self.leading = leading
      self.trailing = trailing
      self.container = container
    }
  }

  /// Between chips.
  public static let gap = 4.0
  /// What each edge keeps for its fade and its arrow (``AnswerOverflow/fadeHeight`` is less).
  public static let clear = 24.0
  /// Within this much a chip counts as clear of an edge.
  public static let tolerance = AnswerOverflow.tolerance

  public let widths: [Double]
  public let margin: Double

  public init(widths: [Double], margin: Double) {
    self.widths = widths
    self.margin = margin
  }

  /// The leading edge of chip `index` in the row's content.
  public func left(_ index: Int) -> Double {
    margin + widths.prefix(index).reduce(0, +) + Double(index) * Self.gap
  }

  /// The trailing edge of chip `index` in the row's content.
  public func right(_ index: Int) -> Double { left(index) + widths[index] }

  /// The chips each edge cuts with the row scrolled to `offset` in a view `container` wide.
  public func cut(offset: Double, container: Double) -> Cut {
    let start = offset + Self.clear - Self.tolerance
    let end = offset + container - Self.clear + Self.tolerance
    let indices = widths.indices
    return Cut(
      leading: offset > Self.tolerance ? indices.last { left($0) < start } : nil,
      trailing: indices.first { right($0) > end }, container: container)
  }

  /// The offset the trailing arrow scrolls to: the chip it cut lands wholly clear of the leading
  /// edge, or the row ends; nil when nothing is cut.
  public func offset(revealingTrailing cut: Cut) -> Double? {
    guard let index = cut.trailing else { return nil }
    return clamped(left(index) - Self.clear, container: cut.container)
  }

  /// The offset the leading arrow scrolls to: the chip it cut lands wholly clear of the trailing
  /// edge, or the row starts; nil when nothing is cut.
  public func offset(revealingLeading cut: Cut) -> Double? {
    guard let index = cut.leading else { return nil }
    return clamped(right(index) - cut.container + Self.clear, container: cut.container)
  }

  private func clamped(_ offset: Double, container: Double) -> Double {
    let content = widths.isEmpty ? 0 : right(widths.count - 1) + margin
    return min(max(offset, 0), max(content - container, 0))
  }
}
