import AICore
import AppKit

/// What the shell owes the page, and keeps from it, about review cards that went for good and
/// runs it told the page to cancel (contract: `commandProgress.action`'s `close` and `cancel`).
struct ReviewClosings {
  /// The targets whose review the page was told to let go. A review the page shows for one of
  /// them later crossed that `close` on its way (an answer to Regenerate or Adjust, a version
  /// settling as the card closed) and is dropped; a new launch has a new target.
  var closed: Set<String> = []
  /// The target whose review card an interrupted write turned into its notice. The notice's
  /// Open still hands the review to the panel, so the page is told to let the review go only once
  /// the notice goes some other way (it expires, is dismissed, or something replaces it).
  var notice: String?
  /// The targets whose run the page was told to cancel (the working capsule's ×, a streaming
  /// answer card's ×, a shortcut pressed over either). The page shows nothing more for them, so a
  /// show for one of them later crossed that `cancel` on its way (the streaming answer's next
  /// paced update) and is dropped: it would bring back the card the person just closed.
  var cancelled: Set<String> = []
}

extension CommandProgressController {
  /// `phase` is for a target the page was told to cancel, or a review for one whose review it
  /// was told to let go: a stale show, which shows nothing.
  func isStale(_ phase: CommandProgressState.Phase, target: String) -> Bool {
    if reviewClosings.cancelled.contains(target) { return true }
    guard case .answer(_, _, _, .some, _) = phase else { return false }
    return reviewClosings.closed.contains(target)
  }

  /// Keeps the targets every `close` and `cancel` sent names (``send(_:)``).
  func noteSent(_ event: CommandProgressActionEvent) {
    switch event.action {
    case .close: reviewClosings.closed.insert(event.target)
    case .cancel: reviewClosings.cancelled.insert(event.target)
    default: break
    }
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
