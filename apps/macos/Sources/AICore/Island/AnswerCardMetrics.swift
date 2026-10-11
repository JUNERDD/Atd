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

/// Whether more of the answer card's answer is hidden past each edge of its scroll view, which
/// decides where the card fades the answer out (or, under Reduce Transparency or Increase
/// Contrast, draws a separator). It changes only when the scroll crosses an edge, so the card
/// updates a couple of times per gesture rather than every frame.
public struct AnswerOverflow: Equatable, Sendable {
  public var top = false
  public var bottom = false

  /// Within this much of an edge the answer counts as reaching it, so a fraction of a point of
  /// scrolling never shows a fade.
  public static let tolerance = 0.5
  /// How far the fade reaches into the answer from an edge with more above or below it.
  public static let fadeHeight = 16.0

  public init(top: Bool = false, bottom: Bool = false) {
    self.top = top
    self.bottom = bottom
  }

  /// The overflow of a scroll view showing `container` points of `content` points of answer,
  /// scrolled to `offset` (its content offset, 0 at the top) with `insets` of content insets.
  public init(
    offset: Double, content: Double, container: Double, insetTop: Double = 0,
    insetBottom: Double = 0
  ) {
    let maxOffset = content + insetBottom - container
    top = offset + insetTop > Self.tolerance
    bottom = offset < maxOffset - Self.tolerance
  }
}
