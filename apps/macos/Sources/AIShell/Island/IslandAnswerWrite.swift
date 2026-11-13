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
/// card into "Writing…" at once without handing the keyboard back until the shortcut's keys come
/// up, since the answer goes where the focus is now; the writer captures that field afresh and
/// writes into it. Written, the island says so and goes; a refused write brings the card back
/// with why, in the panel's words; a write that stopped partway puts the whole answer on the
/// clipboard and says so in a notice, as the page does for its own writes. Nothing is written
/// while the answer streams in. The review card writes the same way (not while a version is
/// pending, nor from its options sheet). Once its answer
/// went in the card is gone for good, and the page is told to let the review go (`close`); after
/// an interrupted write it is told once the notice goes, unless the notice's Open hands the review
/// to the panel instead (``ReviewClosings/notice``). A refused write (or an interrupted one whose
/// answer the clipboard could not take) brings the review card back as it was, version, review
/// and staged changes included, with why as its note, and the review stays.
///
/// Copy is the shell's own too: the whole answer goes on the clipboard as plain text and the card
/// turns into "Copied" (``copyAnswer()``).
extension CommandProgressController {
  /// Safety bound on how long a write handoff waits for held shortcut keys before restoring the card.
  private static let writeHandoffLimit: Duration = .seconds(5)
  private static var nextWriteToken = 0
  private static var activeWriteTokens: [ObjectIdentifier: Int] = [:]
  /// Controllers currently transitioning to `.writing` while shortcut keys are still down, so
  /// stopping ``answerFocus`` keeps the registered write hot keys absorbing repeats until release.
  private static var retainingWriteKeys: Set<ObjectIdentifier> = []

  private struct AnswerWriteContext {
    let mode: TextWriteParams.Mode
    let target: String
    let command: String
    let answer: String
    let priorNote: String?
    let review: CommandProgressState.Review?
    let source: pid_t?
    let wasKey: Bool
    let controllerID: ObjectIdentifier
    let token: Int
  }

  /// The focus is followed exactly while the answer card is up.
  func followAnswerFocus() {
    if state.isAnswering { answerFocus.start() } else { answerFocus.stop() }
  }

  /// The focus changed what the card can offer: its footer changes in place.
  func answerOfferChanged(_ offer: AnswerWriteOffer?) {
    island.model.answerOffer = offer
    if offer != nil || !Self.retainingWriteKeys.contains(ObjectIdentifier(self)) {
      holdWriteKeys(offer)
    }
    guard let shown = state.shown, state.isAnswering, state.drawsProgress else { return }
    island.show(content(shown.phase))
  }

  /// Copy on the answer card: the whole answer goes on the clipboard as plain text, and the
  /// card turns into "Copied", giving the keyboard back to the target's field; the review card,
  /// not while a version is pending, goes with it for good, which the page is told. Nothing is
  /// copied while the answer streams in, and while another write holds the clipboard the card
  /// stays as it is.
  func copyAnswer() {
    let reviewing = state.isReviewing
    guard let target = state.shown?.target, let answer = state.answerShown, state.answerSettled,
      arbiter.writeClipboard(answer)
    else { return }
    present(target: target, phase: .copied)
    if reviewing { send(CommandProgressState.closing(target: target)) }
  }

  /// Insert (``AnswerWriteOffer/insert``) or Replace (`selection`), while the card offers it.
  /// The review card's options sheet holds unsent edits, so its write keys write nothing.
  func writeAnswer(_ mode: TextWriteParams.Mode) {
    guard let shown = state.shown, state.answerSettled, state.drawsProgress,
      case .answer(let command, let answer, let priorNote, let review, _) = shown.phase,
      !reviewSheetOpen, let offer = island.model.answerOffer, offer.offers(mode)
    else { return }
    let target = shown.target
    let source = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let sourceWindow = NSApp.keyWindow
    let wasKey = island.window.isKeyWindow
    answerWriteHandoff.cancel()
    if wasKey {
      island.keyboardTake.cancel()
    } else {
      island.setKeyCapable(false)
    }
    Self.nextWriteToken += 1
    let token = Self.nextWriteToken
    let controllerID = ObjectIdentifier(self)
    Self.activeWriteTokens[controllerID] = token
    writingReview = review == nil ? nil : target
    if !writeKeys.isEmpty, ShortcutRelease.isHeld {
      Self.retainingWriteKeys.insert(controllerID)
    }
    present(target: target, phase: .writing, returningFocus: false)
    Self.retainingWriteKeys.remove(controllerID)
    let context = AnswerWriteContext(
      mode: mode, target: target, command: command, answer: answer, priorNote: priorNote,
      review: review, source: source, wasKey: wasKey, controllerID: controllerID, token: token)
    Task { [weak self] in
      defer {
        if Self.activeWriteTokens[controllerID] == token {
          Self.activeWriteTokens.removeValue(forKey: controllerID)
        }
      }
      let released =
        await self?.waitForWriteHandoff(context, sourceWindow: sourceWindow) ?? false
      guard let self, Self.activeWriteTokens[controllerID] == token else { return }
      await completeAnswerWrite(context, released: released)
    }
  }

  private func waitForWriteHandoff(
    _ context: AnswerWriteContext, sourceWindow: NSWindow?
  ) async -> Bool {
    let keyMonitor =
      island.window.isKeyWindow
      ? NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
        let windowNumber = event.windowNumber
        let swallow = MainActor.assumeIsolated {
          guard let self else { return false }
          return windowNumber == self.island.window.windowNumber && !self.state.takesKeyboard
        }
        return swallow ? nil : event
      } : nil
    defer { if let keyMonitor { NSEvent.removeMonitor(keyMonitor) } }
    return await ShortcutRelease.waitForHandoff(
      until: .now + Self.writeHandoffLimit,
      isValid: { [weak self] in
        guard let self else { return false }
        return Self.activeWriteTokens[context.controllerID] == context.token
          && self.state.shown?.target == context.target
          && self.state.shown?.phase == .writing
          && self.state.drawsProgress
          && NSWorkspace.shared.frontmostApplication?.processIdentifier == context.source
          && NSApp.keyWindow === sourceWindow
      })
  }

  private func completeAnswerWrite(_ context: AnswerWriteContext, released: Bool) async {
    holdWriteKeys(state.isAnswering && state.drawsProgress ? island.model.answerOffer : nil)
    if !state.takesKeyboard, state.drawsProgress { island.setKeyCapable(false) }
    defer {
      if Self.activeWriteTokens[context.controllerID] == context.token,
        writingReview == context.target
      {
        writingReview = nil
      }
    }
    guard released else {
      guard state.shown?.target == context.target, state.shown?.phase == .writing else { return }
      present(
        target: context.target,
        phase: .answer(
          command: context.command, answer: context.answer, note: context.priorNote,
          review: context.review))
      if state.drawsProgress,
        !context.wasKey
          || NSWorkspace.shared.frontmostApplication?.processIdentifier != context.source
      {
        island.setKeyCapable(true, taking: false)
      }
      return
    }
    guard state.shown?.target == context.target, state.shown?.phase == .writing else { return }
    let outcome = await answerWriter(context.answer, context.mode)
    guard Self.activeWriteTokens[context.controllerID] == context.token,
      state.shown?.target == context.target, state.shown?.phase == .writing
    else { return }
    // The card comes back as it was, with why the answer was not written.
    @MainActor func unwritten(_ reason: TextWriteResult.NotOk.Reason) {
      let note = Self.unwritten(reason, app: outcome.app)
      present(
        target: context.target,
        phase: .answer(
          command: context.command, answer: context.answer, note: note, review: context.review))
    }
    switch outcome.result {
    case .ok:
      present(target: context.target, phase: .done)
      if context.review != nil { send(CommandProgressState.closing(target: context.target)) }
    case .notOk(let refusal) where refusal.reason == .interrupted:
      // Another write holding the clipboard leaves the answer only on the card.
      guard arbiter.writeClipboard(context.answer) else { return unwritten(refusal.reason) }
      let message = ShellStrings.shared.text(.commandProgressInterrupted, outcome.app)
      present(target: context.target, phase: .notice(message: message))
      if context.review != nil { reviewClosings.notice = context.target }
    case .notOk(let refusal):
      unwritten(refusal.reason)
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
