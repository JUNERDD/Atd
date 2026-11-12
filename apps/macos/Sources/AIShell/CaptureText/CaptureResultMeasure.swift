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
      let height = IslandController.height(
        of: CaptureResultPanel(model: model, card: card, height: nil), width: width)
      let limit = min(IslandMetrics.maxShape.height, model.heightLimit)
      let size = CGSize(width: width, height: min(height.rounded(.up), limit))
      let body = bodyHeight(of: model, card: card)
      let least = (height - body + min(body, minimumBody)).rounded(.up)
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
    guard model.shownBody(card) != .none else { return 0 }
    let body = CaptureResultBody(model: model, card: card, measuring: true)
      .padding(.vertical, IslandMetrics.sectionGap)
    let width = CaptureResultPlacement.cardWidth - IslandMetrics.cardPadding * 2
    return IslandController.height(of: body, width: width)
  }

  /// A capsule as wide as `view` lays itself out, one capsule high.
  private static func capsule(_ view: some View) -> CGSize {
    let width = NSHostingView(rootView: view.fixedSize()).fittingSize.width
    return CGSize(width: width.rounded(.up), height: IslandMetrics.capsuleHeight)
  }
}
