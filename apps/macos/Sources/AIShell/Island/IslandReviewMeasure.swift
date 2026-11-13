import AICore
import AppKit
import SwiftUI

/// Cached chrome dimensions for ``IslandController/measureReview(command:answer:note:review:)`` so
/// streaming review chunks only re-measure the answer text via TextKit instead of rebuilding the
/// whole review card inside an `NSHostingView`.
struct ReviewMeasureCache {
  struct Key: Equatable {
    let command: String
    let note: String?
    let source: String?
    let hasChanges: Bool
    let showsChanges: Bool
    let pending: CommandProgressState.Review.Pending?
    let version: Int
    let pages: Int
    let count: Int
    let chipsShown: [String]
    let summaryLabel: String?
    let offer: AnswerWriteOffer?
    let labels: IslandLabels
  }

  var key: Key?
  var chromeIdealWidth = 0.0
  var measuredWidth = 0.0
  var chromeHeight = 0.0
}

extension IslandController {
  /// The review card's rest size: as wide as its title row, original, answer and footer within
  /// ``resultCardWidth(ideal:)``, and as tall as everything wraps to at that width, up to
  /// the island's largest shape (``IslandMetrics/reviewCardHeight(natural:)``). A long answer is
  /// measured by its first ``IslandAnswerCard/measuredLength`` characters, as the answer card's.
  func measureReview(
    command: String, answer: String, note: String?, review: CommandProgressState.Review
  ) -> IslandMeasure {
    let limit = IslandAnswerCard.measuredLength
    let sampleAnswer = String(answer.prefix(limit))
    let measuredReview = review.measured(limit: limit)
    let card = IslandReviewCard(
      model: model, command: command, answer: sampleAnswer, note: note,
      review: measuredReview, offer: model.answerOffer, includesAnswer: false)
    let key = ReviewMeasureCache.Key(
      command: command, note: note, source: measuredReview.source,
      hasChanges: measuredReview.changes != nil, showsChanges: model.review.showsChanges,
      pending: measuredReview.pending, version: measuredReview.version, pages: measuredReview.pages,
      count: measuredReview.count, chipsShown: card.chipsShownKey,
      summaryLabel: model.review.changesOptions
        ? ReviewOptionChips.summary(of: model.review.values) : measuredReview.summary,
      offer: model.answerOffer, labels: model.labels)
    if reviewMeasures.key != key {
      reviewMeasures = ReviewMeasureCache(
        key: key,
        chromeIdealWidth: Self.fittingSize(of: card.chromeWidthProbe.fixedSize()).width)
    }
    let textIdealWidth =
      IslandAnswerText.measuredIdealWidth(text: sampleAnswer) + IslandMetrics.cardPadding * 2
    let ideal = resultCardWidth(ideal: max(reviewMeasures.chromeIdealWidth, textIdealWidth))
    // Another version never narrows the card it pages in: it keeps the widest it has been.
    let width = content?.kind == .review ? max(ideal, size?.width ?? 0) : ideal
    let inner = max(width - IslandMetrics.cardPadding * 2, 1)
    if reviewMeasures.measuredWidth != width {
      reviewMeasures.measuredWidth = width
      reviewMeasures.chromeHeight = Self.height(of: card, width: width)
    }
    let answerHeight: Double =
      if let changes = measuredReview.changes, model.review.showsChanges {
        Self.height(
          of: IslandReviewMarkedAnswer(changes: changes).padding(
            .vertical, IslandMetrics.sectionGap),
          width: inner)
      } else if measuredReview.showsPending && sampleAnswer.allSatisfy(\.isWhitespace) {
        Self.height(
          of: Text(verbatim: " ").font(IslandType.answer).padding(
            .vertical, IslandMetrics.sectionGap),
          width: inner)
      } else {
        IslandAnswerText.measuredHeight(text: sampleAnswer, width: inner)
          + IslandMetrics.sectionGap * 2
      }
    let natural = reviewMeasures.chromeHeight + answerHeight
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
