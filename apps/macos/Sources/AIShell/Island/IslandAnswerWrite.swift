import AICore
import AppKit

/// Writes the answer card's answer into the field the person's focus is in, in `mode` (`cursor`
/// for Insert, `selection` for Replace), as the shell's own `text.write` does: the outcome, and
/// the name of the app it wrote into (or tried to), for the note.
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
/// clipboard and says so in a notice, as the page does for its own writes.
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

  /// Insert (`cursor`) or Replace (`selection`), while the card offers it.
  func writeAnswer(_ mode: TextWriteParams.Mode) {
    guard let shown = state.shown, case .answer(let command, let answer, _) = shown.phase,
      let offer = island.model.answerOffer, mode == .cursor || offer.replaces
    else { return }
    let target = shown.target
    island.setKeyCapable(false)
    present(target: target, phase: .writing, returningFocus: false)
    Task {
      let outcome = await answerWriter(answer, mode)
      guard state.shown?.target == target, state.shown?.phase == .writing else { return }
      switch outcome.result {
      case .ok:
        present(target: target, phase: .done)
      case .notOk(let refusal) where refusal.reason == .interrupted:
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(answer, forType: .string)
        let message = ShellStrings.shared.text(.commandProgressInterrupted, outcome.app)
        present(target: target, phase: .notice(message: message))
      case .notOk(let refusal):
        let note = Self.unwritten(refusal.reason, app: outcome.app)
        present(target: target, phase: .answer(command: command, answer: answer, note: note))
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
      case .failed, .interrupted: .commandProgressUnwrittenFailed
      }
    return ShellStrings.shared.text(key, app)
  }
}
