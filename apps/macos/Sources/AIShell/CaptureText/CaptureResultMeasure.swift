import AICore
import AppKit
import SwiftUI

/// The size ``CaptureResultCardView`` takes for what ``CaptureResultCardModel`` presents, laid
/// out as it draws it: the card ``CaptureResultPlacement/cardWidth`` wide and as tall as its
/// content, up to the island's largest shape, past which its body scrolls; a capsule as wide as
/// its contents, one capsule high.
enum CaptureResultMeasure {
  /// The most of an answer the card measures (``IslandAnswerCard/measuredLength``).
  static let measuredLength = IslandAnswerCard.measuredLength
  /// The most replacements the card measures: a row holds two lines at least (the new text and its
  /// original), some 40 points, so this many reach the island's largest shape on their own.
  static let measuredRows = 12

  /// The least of the card's body it keeps in view where its place cuts it short
  /// (``CaptureResultPlacement/capture(size:minimumHeight:selection:bars:workArea:keeping:)``):
  /// some two replacement rows, or four lines of an answer.
  static let minimumBody: CGFloat = 80

  /// The presentation's size, and the least height the card may be cut to: everything but its
  /// body, which scrolls, and ``minimumBody`` of the body (the size's own height when less). A
  /// capsule is never cut.
  static func size(of model: CaptureResultCardModel) -> (size: CGSize, minimumHeight: CGFloat) {
    switch model.presentation {
    case .hidden:
      return (.zero, 0)
    case .card:
      guard let card = model.card else { return (.zero, 0) }
      let width = CaptureResultPlacement.cardWidth
      let chrome = IslandController.height(
        of: CaptureResultPanel(model: model, card: card, height: nil, includesBody: false),
        width: width)
      let body = bodyHeight(of: model, card: card)
      let height = chrome + body
      let limit = min(IslandMetrics.maxShape.height, model.heightLimit)
      let size = CGSize(width: width, height: min(height.rounded(.up), limit))
      let least = (chrome + min(body, minimumBody)).rounded(.up)
      return (size, min(least, size.height))
    case .copied(let text):
      let size = capsule(IslandStatusCapsule(text: text, running: false))
      return (size, size.height)
    }
  }

  /// The card's body as the card lays it out unscrolled (``CaptureResultPanel``), padding and all;
  /// zero for a card without one.
  private static func bodyHeight(of model: CaptureResultCardModel, card: CaptureResultCard)
    -> CGFloat
  {
    let width = CaptureResultPlacement.cardWidth - IslandMetrics.cardPadding * 2
    switch model.shownBody(card) {
    case .none:
      return 0
    case .answer(let text):
      return IslandAnswerText.measuredHeight(
        text: String(text.prefix(measuredLength)), width: width)
        + IslandMetrics.sectionGap * 2
    case .skeleton, .items, .replacements:
      let body = CaptureResultBody(model: model, card: card, measuring: true)
        .padding(.vertical, IslandMetrics.sectionGap)
      return IslandController.height(of: body, width: width)
    }
  }

  /// A capsule as wide as `view` lays itself out, one capsule high.
  private static func capsule(_ view: some View) -> CGSize {
    let width = IslandController.fittingSize(of: view.fixedSize()).width
    return CGSize(width: width.rounded(.up), height: IslandMetrics.capsuleHeight)
  }
}
