import AICore
import AppKit

/// Writes the answer card's answer into the field the person's focus is in, in `mode` (Insert's
/// `cursor`, or `afterSelection` while the field has a selection; Replace's `selection`), as the
/// shell's own `text.write` does: the outcome, and the name of the app it wrote into (or tried
/// to), for the note.
typealias AnswerWriter = (_ answer: String, _ mode: TextWriteParams.Mode) async ->
  AnswerWriteOutcome

struct AnswerWriteOutcome {
  let result: TextWriteResult
  let app: String
}

/// The answer card's Insert and Replace, which are the shell's own, as Copy is (contract:
/// `commandProgress.show`'s answer card). They show only while the person's focus is a field
/// that can take text (``AnswerFocusWatch``, followed while the card is up). A press turns the
/// card into "Writing…" without handing the keyboard back to the field the command came from,
/// since the answer goes where the focus is now; the writer captures that field afresh and
/// writes into it. Written, the island says so and goes; a refused write brings the card back
/// with why, in the panel's words; a write that stopped partway puts the whole answer on the
/// clipboard and says so in a notice, as the page does for its own writes. The review card writes
/// the same way (not while a version is pending, nor from its options sheet). Once its answer
/// went in the card is gone for good, and the page is told to let the review go (`close`); after
/// an interrupted write it is told once the notice goes, unless the notice's Open hands the review
/// to the panel instead (``ReviewClosings/notice``). A refused write (or an interrupted one whose
/// answer the clipboard could not take) brings the review card back as it was, version, review
/// and staged changes included, with why as its note, and the review stays.
///
/// Copy is the shell's own too: the whole answer goes on the clipboard as plain text and the card
/// turns into "Copied" (``copyAnswer()``).
extension CommandProgressController {
  /// The focus is followed exactly while the answer card is up.
  func followAnswerFocus() {
    if state.isAnswering { answerFocus.start() } else { answerFocus.stop() }
  }

  /// The focus changed what the card can offer: its footer changes in place.
  func answerOfferChanged(_ offer: AnswerWriteOffer?) {
    island.model.answerOffer = offer
    holdWriteKeys(offer)
    guard let shown = state.shown, state.isAnswering else { return }
    island.show(content(shown.phase))
  }

  /// Copy on the answer card: the whole answer goes on the clipboard as plain text, and the
  /// card turns into "Copied", giving the keyboard back to the target's field; the review card,
  /// not while a version is pending, goes with it for good, which the page is told. While another
  /// write holds the clipboard the card stays as it is.
  func copyAnswer() {
    let reviewing = state.isReviewing
    guard let target = state.shown?.target, let answer = state.answerShown,
      state.reviewShown?.pending == nil, arbiter.writeClipboard(answer)
    else { return }
    present(target: target, phase: .copied)
    if reviewing { send(CommandProgressState.closing(target: target)) }
  }

  /// Insert (``AnswerWriteOffer/insert``) or Replace (`selection`), while the card offers it.
  /// The review card's options sheet holds unsent edits, so its write keys write nothing.
  func writeAnswer(_ mode: TextWriteParams.Mode) {
    guard let shown = state.shown,
      case .answer(let command, let answer, _, let review) = shown.phase,
      review?.pending == nil, !reviewSheetOpen, let offer = island.model.answerOffer,
      offer.offers(mode)
    else { return }
    let target = shown.target
    writingReview = review == nil ? nil : target
    island.setKeyCapable(false)
    present(target: target, phase: .writing, returningFocus: false)
    Task {
      let outcome = await answerWriter(answer, mode)
      defer { writingReview = nil }
      guard state.shown?.target == target, state.shown?.phase == .writing else { return }
      // The card comes back as it was, with why the answer was not written.
      @MainActor func unwritten(_ reason: TextWriteResult.NotOk.Reason) {
        let note = Self.unwritten(reason, app: outcome.app)
        present(
          target: target,
          phase: .answer(command: command, answer: answer, note: note, review: review))
      }
      switch outcome.result {
      case .ok:
        present(target: target, phase: .done)
        if review != nil { send(CommandProgressState.closing(target: target)) }
      case .notOk(let refusal) where refusal.reason == .interrupted:
        // Another write holding the clipboard leaves the answer only on the card.
        guard arbiter.writeClipboard(answer) else { return unwritten(refusal.reason) }
        let message = ShellStrings.shared.text(.commandProgressInterrupted, outcome.app)
        present(target: target, phase: .notice(message: message))
        if review != nil { reviewClosings.notice = target }
      case .notOk(let refusal):
        unwritten(refusal.reason)
      }
    }
  }

  /// Why the answer was not written into `app`, in the panel's words.
  private static func unwritten(_ reason: TextWriteResult.NotOk.Reason, app: String) -> String {
    let key: ShellStringKey =
      switch reason {
      case .notTrusted: .commandProgressUnwrittenNotTrusted
      case .targetGone: .commandProgressUnwrittenTargetGone
      case .targetChanged: .commandProgressUnwrittenTargetChanged
      case .noSelection: .commandProgressUnwrittenNoSelection
      case .secureInput: .commandProgressUnwrittenSecureInput
      case .failed, .interrupted, .unsupportedSelection: .commandProgressUnwrittenFailed
      }
    return ShellStrings.shared.text(key, app)
  }
}
