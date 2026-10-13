/// The answer card's geometry: the card the island grows into where a run's answer could not be
/// written. It shares the options card's corner, padding, title row and footer
/// (``IslandMetrics/cardRadius``, ``IslandMetrics/cardPadding``, ``IslandMetrics/headerHeight``,
/// ``IslandMetrics/footerHeight``); between them, the note under the title and the answer, which
/// scrolls inside the card once the card would be taller than ``IslandMetrics/maxShape``.
extension IslandMetrics {
  /// The note under the title wraps to at most this many lines.
  public static let maxNoteLines = 2
  /// Between the note and the answer.
  public static let noteGap = 2.0

  /// The card's height for a note `note` points tall (0 without one) and an answer `answer`
  /// points tall: everything shown, up to ``maxShape``'s height.
  public static func answerCardHeight(note: Double, answer: Double) -> Double {
    min((answerChrome(note: note) + max(answer, 0)).rounded(.up), maxShape.height)
  }

  /// How tall the answer may show before it scrolls, under a note `note` points tall.
  public static func answerRoom(note: Double) -> Double {
    maxShape.height - answerChrome(note: note)
  }

  /// Everything but the answer: the padding, the title row, the note, the gaps either side of
  /// the answer and the footer.
  private static func answerChrome(note: Double) -> Double {
    cardPadding * 2 + headerHeight + (note > 0 ? note + noteGap : 0) + sectionGap * 2
      + footerHeight
  }
}

/// Whether more of a card's scrolling content is hidden past each edge of its scroll view, which
/// decides where the card fades it out (or, under Reduce Transparency or Increase Contrast, draws
/// a separator): the answer card's answer, scrolling vertically, and the compose card's chips,
/// scrolling sideways. `top` is the start edge along the scroll axis (the top, or the leading
/// side) and `bottom` the end edge (the bottom, or the trailing side), and the offsets, sizes and
/// insets are measured along that axis. It changes only when the scroll crosses an edge, so the
/// card updates a couple of times per gesture rather than every frame.
public struct AnswerOverflow: Equatable, Sendable {
  public var top = false
  public var bottom = false

  /// Within this much of an edge the answer counts as reaching it, so a fraction of a point of
  /// scrolling never shows a fade.
  public static let tolerance = 0.5
  /// How far the fade reaches into the content from an edge with more past it.
  public static let fadeHeight = 16.0

  public init(top: Bool = false, bottom: Bool = false) {
    self.top = top
    self.bottom = bottom
  }

  /// The overflow of a scroll view showing `container` points of `content` points of answer,
  /// scrolled to `offset` (its content offset, 0 at the start) with `insets` of content insets.
  public init(
    offset: Double, content: Double, container: Double, insetTop: Double = 0,
    insetBottom: Double = 0
  ) {
    let maxOffset = content + insetBottom - container
    top = offset + insetTop > Self.tolerance
    bottom = offset < maxOffset - Self.tolerance
  }
}

/// What the answer card offers to write where the person's focus is now: Insert at the focus
/// while it is a field that can take text, and Replace as well while that field has a selection.
/// The primary action, which ⌘Return performs (and Return, while the card has the keyboard), is
/// Replace when it shows, else Insert. `app` is the app the field is in, named in the actions' tooltips and in
/// a refusal's note.
public struct AnswerWriteOffer: Equatable, Sendable {
  public let app: String
  public let replaces: Bool

  public init(app: String, replaces: Bool) {
    self.app = app
    self.replaces = replaces
  }

  /// The write the primary key performs: over the selection, or at the focus.
  public var primary: TextWriteParams.Mode { replaces ? .selection : .cursor }

  /// The answer card's write keys. Inserting needs the person's focus in another app's field,
  /// which takes the keyboard from the card, so both are hot keys held while the card offers a
  /// write and work wherever the focus is; plain Return also performs the primary write while the
  /// card has the keyboard.
  public enum Key: Sendable {
    /// ⌘Return: the primary write.
    case primary
    /// ⌥⌘Return: Insert beside Replace.
    case insert
  }

  /// The write `key` performs; nil for ⌥⌘Return with nothing besides the primary.
  public func write(for key: Key) -> TextWriteParams.Mode? {
    switch key {
    case .primary: primary
    case .insert: replaces ? .cursor : nil
    }
  }

  /// The keys that perform `mode`, as its button shows them: one keycap, as the card's ⌘C hint
  /// shows its keys.
  public func keys(for mode: TextWriteParams.Mode) -> String {
    mode == primary ? "⌘↩" : "⌥⌘↩"
  }
}
