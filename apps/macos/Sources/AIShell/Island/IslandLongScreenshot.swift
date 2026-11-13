import AICore
import AppKit
import Carbon.HIToolbox

/// The long screenshot on the command island (decision D11): display only. Its orchestrator
/// shows each phase and hears every press through ``onEvent``; the island owns only what it
/// draws (the card's kept range and what is on the image, its answer pages). It is the shell's content as the
/// screen recording is, taking the island through their one gate in turn (D13,
/// ``CommandProgressController+Recording``):
///
/// - ``showProcessing()`` and ``showResult(_:)`` yield it, as the recording's result card does:
///   the page's next show, or the recording's content, takes the island. Nothing offers a long
///   screenshot again once its card went, so a replaced card is not lost: it waits, its state
///   kept (an answer still coming goes on arriving), and comes back when the island would
///   otherwise leave (``resumeIfWaiting()``). Neither takes the island from what keeps it
///   (``CommandProgressController/islandTaken``): the card then waits the same way, and
///   processing shows nothing. A card that shows at once, after the person's own action, takes
///   the keyboard; one that comes back by itself does not, so it never takes the keyboard from
///   where the person is typing: a click on it does;
/// - ``release()`` takes the card off the island and keeps its state, so showing the same
///   source again (after annotating, say) keeps its kept range, annotations, answers and ask text;
///   ``forgetCard()`` lets that state go.
///
/// The card takes the keyboard while it shows (its keys: ``key(_:)``, ⌘C and ⌘↩:
/// ``keyEquivalent(_:)``). Its footer actions report back on their own buttons
/// (``cardFeedback(_:_:)``), so the card stays. Its full-screen preview, where it is also
/// annotated, is its ``lightbox``, over the card model the card shares with it; the card leaving
/// the island closes it at once.
final class IslandLongScreenshot {
  /// What the card asks for. ``LongScreenshotCardEvent/close`` comes once the card has gone.
  var onEvent: ((LongScreenshotCardEvent) -> Void)?

  /// The card's footer actions, which report back on their own buttons.
  enum CardAction: Hashable {
    case copy, attach
  }

  /// What of the long screenshot the island shows; nil while nothing.
  enum Showing: Equatable {
    case processing, copied, result
  }

  private(set) var showing: Showing?
  /// The card gave way to the page's progress or the recording's content, or found the island
  /// taken: it comes back when the island is free (``resumeIfWaiting()``).
  private var waiting = false
  private var copiedToken = 0
  private unowned let progress: CommandProgressController
  /// The card's full-screen preview.
  let lightbox = IslandLightbox()
  /// What the preview's text commands use; its orchestrator sets it.
  var textServices = LongScreenshotTextServices()

  init(progress: CommandProgressController) {
    self.progress = progress
  }

  private var island: IslandController { progress.island }

  /// The result card shows on the island.
  var showsCard: Bool { showing == .result }

  /// The processing capsule ("Processing the long screenshot…") until ``showResult(_:)`` or
  /// ``release()``, unless the page's progress replaces it first; none while what is on the
  /// island keeps it (``CommandProgressController/islandTaken``).
  func showProcessing() {
    guard !progress.islandTaken else { return }
    let message = island.model.labels.longScreenshot.processing
    present(.processing, .recordingStatus(message: message, outcome: nil))
  }

  /// Shows the "Copied" status capsule (`IslandContent.copied`) for
  /// ``CommandProgressState/doneDuration`` (1.5 s), then leaves.
  func showCopied() {
    if showing == .result {
      leaveCard()
      island.setKeyCapable(false)
      showing = nil
      waiting = true
    }
    copiedToken += 1
    let token = copiedToken
    present(.copied, .copied, takingKeyboard: false)
    guard showing == .copied else { return }
    Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard let self, token == copiedToken, showing == .copied else { return }
      release()
    }
  }

  /// The result card of `source`. The same source shown again keeps the card's state; another
  /// one starts over.
  func showResult(_ source: LongScreenshotCardSource) {
    let model: IslandLongScreenshotCardModel
    if let kept = island.model.longScreenshotCard, kept.source.id == source.id {
      model = kept
    } else {
      // The card it replaces stops an answer still coming, as a card leaving the screen does.
      island.model.longScreenshotCard?.asking.stopAnswer()
      island.model.longScreenshotCard?.close()
      model = IslandLongScreenshotCardModel(LongScreenshotCardState(source: source))
      wire(model)
    }
    island.model.longScreenshotCard = model
    // Something else on the island keeps it: the card waits until the island is free.
    if showing == nil, progress.islandTaken {
      waiting = true
      return
    }
    model.reopen()
    present(.result, .longScreenshotResult)
  }

  /// The island is about to leave with nothing to show: a card that waited comes back instead,
  /// leaving the keyboard where it is. True when it did.
  func resumeIfWaiting() -> Bool {
    guard waiting, !progress.islandTaken else { return false }
    waiting = false
    guard let model = island.model.longScreenshotCard else { return false }
    model.reopen()
    present(.result, .longScreenshotResult, takingKeyboard: false)
    return showing == .result
  }

  /// Shows `feedback` for the card's `action` on that footer button, the card staying on the
  /// island; a kept card that does not show takes it too.
  func cardFeedback(_ action: CardAction, _ feedback: IslandRecording.CardFeedback) {
    island.model.longScreenshotCard?.feedback.show(feedback, for: action)
  }

  /// The page reported ask `askID`: `phase` with the answer's text so far. The card applies it
  /// whether or not it shows; an ask it no longer runs changes nothing.
  func updateAnswer(askID: String, phase: RecordingAnswer.Phase, text: String) {
    island.model.longScreenshotCard?.asking.apply(askID: askID, phase: phase, text: text)
  }

  /// Takes the long screenshot's content off the island, keeping the card's state; what the page
  /// shows draws again.
  func release() {
    if showing != .copied { waiting = false }
    copiedToken += 1
    guard let previous = showing else { return }
    showing = nil
    if previous == .result { leaveCard() }
    progress.releaseShell()
  }

  /// Lets the kept card go: it can no longer be shown again. A card still showing leaves first,
  /// as ``release()`` takes it, without ``LongScreenshotCardEvent/close``.
  func forgetCard() {
    waiting = false
    if showing == .result { release() }
    guard let model = island.model.longScreenshotCard else { return }
    model.close()
    island.model.longScreenshotCard = nil
  }

  /// Puts `content` on the island as `next`, yielding it to the page's next show; a card that
  /// is not `takingKeyboard` takes it only on a click.
  private func present(_ next: Showing, _ content: IslandContent, takingKeyboard: Bool = true) {
    if showing == .result, next != .result {
      leaveCard()
      island.setKeyCapable(false)
    }
    showing = next
    // Only a hold ends with the page's progress drawing instead, and nothing here holds.
    guard
      progress.showShell(
        content, by: .longScreenshot, holding: false, takingKeyboard: takingKeyboard)
    else { return replaced() }
  }

  // MARK: The card

  /// The page's progress, or the recording's content, took the island. A card waits to come back
  /// (``resumeIfWaiting()``), its state kept: an answer still coming goes on arriving, applied
  /// while the card is away (``updateAnswer(askID:phase:text:)``). Processing just goes, its card
  /// showing or waiting once the text is read.
  func replaced() {
    copiedToken += 1
    guard let previous = showing else { return }
    lightbox.close(animated: false)
    showing = nil
    guard previous == .result else { return }
    waiting = true
  }

  /// The card, or its lightbox, has the keyboard: a shortcut pressed now only closes it.
  var cardHasKeyboard: Bool {
    showing == .result && (island.window.isKeyWindow || lightbox.isKey)
  }

  /// The close button, Escape, or a shortcut pressed while the card had the keyboard: the card
  /// goes for good, then the orchestrator hears it.
  func closeCard() {
    guard showing == .result else { return }
    forgetCard()
    onEvent?(.close)
  }

  /// Taken off the island by its own flow (``release()``: the editor, an attached edit), the card
  /// stops an answer still coming; a card that only waits keeps it coming.
  private func leaveCard() {
    lightbox.close(animated: false)
    island.model.longScreenshotCard?.asking.stopAnswer()
  }

  private func wire(_ model: IslandLongScreenshotCardModel) {
    model.onEvent = { [weak self] event in
      if event == .close { self?.closeCard() } else { self?.onEvent?(event) }
    }
    model.onResize = { [weak self] in self?.resize() }
    model.openLightbox = { [weak self, weak model] y, annotate in
      guard let model else { return }
      self?.openLightbox(model, at: y, annotate: annotate)
    }
    model.asking.writeClipboard = { [weak self] in
      self?.progress.arbiter.writeClipboard($0) ?? false
    }
  }

  /// The card's lightbox, from its preview: `y` (image points) about a third down the view, or
  /// the top; in annotate mode when `annotate`. Only while the card shows.
  private func openLightbox(
    _ model: IslandLongScreenshotCardModel, at y: CGFloat?, annotate: Bool
  ) {
    guard showing == .result, island.model.longScreenshotCard === model,
      let screen = island.window.screen ?? NSScreen.main
    else { return }
    let labels = island.model.labels.longScreenshot
    let services = textServices
    lightbox.open(
      on: screen, from: island.screenRect(model.mediaFrame), returningKeyTo: island.window
    ) { lightbox in
      IslandLongScreenshotLightbox(
        card: model, labels: labels, lightbox: lightbox, at: y, annotate: annotate,
        services: services)
    }
  }

  /// The card's size may have changed (an answer growing): the shape moves in place.
  private func resize() {
    guard showing == .result else { return }
    island.show(.longScreenshotResult, inPlace: true)
  }

  // MARK: Keys

  /// A key press while the card has the keyboard: true when it was taken. Escape ends an edit
  /// of the ask field, then stops an answer still coming, then closes the card; ⌘C copies the
  /// kept image and ⌘↩ attaches it (``keyEquivalent(_:)``); ↑ and ↓ nudge the focused handle
  /// (⇧ by 100 pt) unless the field is being edited or a button has the keyboard focus, and
  /// Space opens the full-screen preview then. Return in the field sends.
  func key(_ event: NSEvent) -> Bool {
    guard showing == .result, let card = island.model.longScreenshotCard else { return false }
    let field = island.editingField
    if field?.hasMarkedText() == true { return false }
    if keyEquivalent(event) { return true }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch Int(event.keyCode) {
    case kVK_Escape:
      if field != nil {
        island.window.makeFirstResponder(nil)
      } else if !card.asking.stopAnswer() {
        closeCard()
      }
      return true
    case kVK_UpArrow where field == nil && !card.controlFocused,
      kVK_DownArrow where field == nil && !card.controlFocused:
      guard modifiers.isEmpty || modifiers == .shift else { return false }
      return card.nudge(down: Int(event.keyCode) == kVK_DownArrow, shift: modifiers == .shift)
    case kVK_Space where field == nil && !card.controlFocused && modifiers.isEmpty:
      guard !event.isARepeat else { return true }
      card.openLightbox(nil, false)
      return true
    default:
      return false
    }
  }

  /// The footer's shortcuts while the card has the keyboard (``IslandShellFooterKey``): ⌘C
  /// copies the kept image, as Copy does, and ⌘↩ attaches it, as Attach to Conversation does.
  func keyEquivalent(_ event: NSEvent) -> Bool {
    guard showing == .result, let card = island.model.longScreenshotCard,
      let key = IslandShellFooterKey(event, field: island.editingField)
    else { return false }
    switch key {
    case .copy: card.onEvent(.copy(card.state.kept))
    case .attach: card.onEvent(.attach(card.state.kept))
    }
    return true
  }
}
