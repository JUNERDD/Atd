import AICore
import AppKit
import SwiftUI

/// What measuring the shell cards shares (the recording's result card, the long screenshot's).
extension IslandController {
  /// The answer scroll body's height (including insets; nil without a page): the tallest it has
  /// been while the card is open, up to `cap`; measured again at `width` (the card's) while it is
  /// under the cap, so an answer at the cap costs no measuring as it streams. `seeks` measures
  /// the text as a card with a player draws it, its times set as links.
  func answerFloor<Ask: CardAsk, Quick: IslandQuickAsk>(
    _ asking: IslandAsking<Ask, Quick>, labels: IslandAskLabels<Quick>, cap: Double,
    width: Double?, seeks: Bool
  ) -> Double? {
    guard let shown = asking.answers.shown else { return nil }
    if let width, asking.answerFloor < cap {
      let inner =
        width - IslandMetrics.cardPadding * 2 - IslandMetrics.recordingInset * 2
        - IslandMetrics.recordingAnswerIndent - IslandMetrics.rowPadding
      let text = IslandAskAnswerText(
        answer: shown, labels: labels, seek: seeks ? { _ in } : nil)
      let height =
        text.measuredHeight(width: max(inner, 1))
        + IslandMetrics.recordingAnswerTextTop + IslandMetrics.recordingAnswerTextBottom
      asking.answerFloor = max(asking.answerFloor, min(height.rounded(.up), cap))
    }
    return min(asking.answerFloor, cap)
  }
}
