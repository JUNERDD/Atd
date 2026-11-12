import AICore
import AppKit
import SwiftUI

extension IslandController {
  /// The review card's rest size: as wide as its title row, original, answer and footer within
  /// ``resultCardWidth(ideal:)``, and as tall as everything wraps to at that width, up to
  /// the island's largest shape (``IslandMetrics/reviewCardHeight(natural:)``). A long answer is
  /// measured by its first ``IslandAnswerCard/measuredLength`` characters, as the answer card's.
  func measureReview(
    command: String, answer: String, note: String?, review: CommandProgressState.Review
  ) -> IslandMeasure {
    let limit = IslandAnswerCard.measuredLength
    let card = IslandReviewCard(
      model: model, command: command, answer: String(answer.prefix(limit)), note: note,
      review: review.measured(limit: limit), offer: model.answerOffer)
    let ideal = resultCardWidth(
      ideal: NSHostingView(rootView: card.widthProbe.fixedSize()).fittingSize.width)
    // Another version never narrows the card it pages in: it keeps the widest it has been.
    let width = content?.kind == .review ? max(ideal, size?.width ?? 0) : ideal
    let natural = Self.height(of: card, width: width)
    return IslandMeasure(
      size: WindowSize(width: width, height: IslandMetrics.reviewCardHeight(natural: natural)))
  }
}

extension CommandProgressState.Review {
  /// The review with its original and changes cut to about `limit` characters, which is all that
  /// can show in the card's largest shape.
  fileprivate func measured(limit: Int) -> Self {
    let changes = changes.map { runs in
      var left = limit
      var kept: [Change] = []
      for run in runs where left > 0 {
        let text = String(run.text.prefix(left))
        left -= text.count
        kept.append(Change(kind: run.kind, text: text))
      }
      return kept
    }
    return Self(
      source: source.map { String($0.prefix(limit)) }, changes: changes, version: version,
      count: count, options: options, summary: summary, adjustments: adjustments,
      pending: pending)
  }
}
