import AICore
import SwiftUI

/// The pages of the result card's body: once the run has versions, each version made, and while
/// another one is made, that one after them as it grows (``CaptureResultCard/draft``), which the
/// card shows unless the person paged back (``CaptureResultCardModel/pagedBack``). Both containers
/// of the card's content (the floating card, the long screenshot's side panel) read them here, so
/// they page, follow a streaming page and start a page at its top alike.
extension CaptureResultCardModel {
  /// The page a card shows, by its run: turning to another one, or another run's card, starts the
  /// body at its top (``CaptureResultPageTop``).
  struct Page: Hashable {
    let run: String
    let number: Int
  }

  /// `card` shows the version being made.
  func showsDraft(_ card: CaptureResultCard) -> Bool { card.draft != nil && !pagedBack }

  /// What `card`'s body shows: the version being made on its page, else the version shown.
  func shownBody(_ card: CaptureResultCard) -> CaptureResultCard.Body {
    showsDraft(card) ? card.draft ?? card.body : card.body
  }

  /// The pager's page shown, from 1, of ``CaptureResultCard/Versions/pages``.
  func page(of versions: CaptureResultCard.Versions) -> Int {
    versions.drafting && !pagedBack ? versions.count + 1 : versions.version
  }

  /// The page `card` shows, which starts at its top whenever it changes.
  func page(_ card: CaptureResultCard) -> Page {
    Page(run: card.run, number: card.versions.map { page(of: $0) } ?? 1)
  }

  /// The page shown is the one the run is producing (its answer, or the version being made), so
  /// the body keeps its newest content in view as it streams in, until the person scrolls away.
  func follows(_ card: CaptureResultCard) -> Bool {
    card.busy && (card.draft == nil || !pagedBack)
  }
}

/// Starts each page of the card's body at its top: the body is the scroll view's content, which
/// `proxy` scrolls back to its start when the page shown changes (``CaptureResultCardModel/page(_:)``),
/// whatever was scrolled on the page before. A page turned to while it streams (`follows`) starts
/// at its end instead, so it keeps its newest content in view from there.
struct CaptureResultPageTop: ViewModifier {
  let page: CaptureResultCardModel.Page
  let follows: Bool
  let proxy: ScrollViewProxy

  private static let top = "captureResultPageTop"

  func body(content: Content) -> some View {
    content
      .id(Self.top)
      .onChange(of: page) { proxy.scrollTo(Self.top, anchor: follows ? .bottom : .top) }
  }
}
