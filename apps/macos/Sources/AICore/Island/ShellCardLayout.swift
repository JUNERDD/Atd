/// The shell cards' measured stack (the recording's result card, the long screenshot's), fitted
/// to a work area: the card's size, its media (the recording's player, the long screenshot's
/// preview), the bounded answer, notes and quick-ask regions, and the stack's full height. The
/// island interpolates it as one value while a card reflows (`IslandShellGeometry`), so both
/// cards share it.
extension IslandMetrics {
  public struct ShellCardLayout: Equatable, Sendable {
    public let size: WindowSize
    /// The player's size, or the long screenshot's preview box.
    public let media: WindowSize
    /// The whole answer section, including its gap, separator and header; zero without a page.
    public let answerSlotHeight: Double
    /// The recording's processing notes; zero for a card without notes.
    public let notesHeight: Double
    public let quickAsksHeight: Double
    /// Taller than `size.height` only when even the minimum controls need outer scrolling.
    public let contentHeight: Double

    public init(
      size: WindowSize, media: WindowSize, answerSlotHeight: Double, notesHeight: Double,
      quickAsksHeight: Double, contentHeight: Double
    ) {
      self.size = size
      self.media = media
      self.answerSlotHeight = answerSlotHeight
      self.notesHeight = notesHeight
      self.quickAsksHeight = quickAsksHeight
      self.contentHeight = contentHeight
    }
  }

  /// An answer scroll body reduced to fit a short work area keeps one full line.
  public static let shellAnswerMinimum = 26.0
}
