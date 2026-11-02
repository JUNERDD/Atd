import AICore
import AppKit

/// What the shell owes the page, and keeps from it, about review cards that went for good
/// (contract: `commandProgress.action`'s `close`).
struct ReviewClosings {
  /// The targets whose review the page was told to let go. A review the page shows for one of
  /// them later crossed that `close` on its way (an answer to Regenerate or Adjust, a version
  /// settling as the card closed) and is dropped; a new launch has a new target.
  var closed: Set<String> = []
  /// The target whose review card an interrupted write turned into its notice. The notice's
  /// Open still hands the review to the panel, so the page is told to let the review go only once
  /// the notice goes some other way (it expires, is dismissed, or something replaces it).
  var notice: String?
}

extension CommandProgressController {
  /// `phase` is a review for a target whose review the page was told to let go: a stale answer,
  /// which shows nothing.
  func isStaleReview(_ phase: CommandProgressState.Phase, target: String) -> Bool {
    guard case .answer(_, _, _, .some) = phase else { return false }
    return reviewClosings.closed.contains(target)
  }

  /// Keeps the targets every `close` sent names (``send(_:)``).
  func noteSent(_ event: CommandProgressActionEvent) {
    if event.action == .close { reviewClosings.closed.insert(event.target) }
  }

  /// After every change of what shows: the interrupted review write's notice went other than
  /// through its Open (which clears ``ReviewClosings/notice`` first), so the page lets the review
  /// go now.
  func settleReviewNotice() {
    guard let target = reviewClosings.notice else { return }
    if state.shown?.target == target, case .notice = state.shown?.phase { return }
    reviewClosings.notice = nil
    send(CommandProgressState.closing(target: target))
  }
}
