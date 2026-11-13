import AICore
import AppKit
import Carbon.HIToolbox

/// The shell's screen recording on the command island (architecture R7–R10): display only. The
/// orchestrator shows each phase and hears every press through ``onEvent``; the island owns only
/// what it draws (the capsule's values, the result card's trim, playback and answer pages). It
/// shares the island through its one owner, ``CommandProgressController``:
///
/// - ``showCapsule(_:)``, ``showDiscard(elapsed:)`` and ``showProcessing(_:)`` hold the island;
///   the page's progress waits under them;
/// - ``showStatus(_:kind:)`` (a check, or a warning, and words, going by itself after
///   ``statusDuration``) and ``showResult(_:)`` yield it: the page's next show replaces them,
///   and replacing the result card calls ``onResultReplaced``. What the page showed under a
///   hold draws as soon as the hold ends, so a result shown then is replaced at once (and told);
/// - ``release()`` takes whatever of the recording shows away.
///
/// The result card takes the keyboard while it shows (its keys: ``key(_:)``, ⌘C and ⌘↩:
/// ``keyEquivalent(_:)``); its state stays with the recording, so showing the same recording
/// again keeps its trim and answers. Its footer actions report back on their own buttons
/// (``cardFeedback(_:_:)``), so the card stays. Its full-screen preview is its ``lightbox``, over
/// the card model the card shares with it; the card leaving the island closes it at once.
final class IslandRecording {
  /// What the recording's island contents ask for.
  var onEvent: ((IslandRecordingEvent) -> Void)?
  /// The page's progress, or a command shortcut's press, replaced the result card: the
  /// recording can be offered again ("Show Last Recording").
  var onResultReplaced: (() -> Void)?
  /// How long a finished status stays before it goes by itself.
  static let statusDuration: Duration = .milliseconds(2200)

  /// What of the recording the island shows; nil while nothing.
  enum Showing: Equatable {
    case capsule, discard, processing, status, result
  }

  /// How a status ends: a result went somewhere (a check), or it could not (a warning).
  enum StatusKind: Equatable {
    case done, failed
  }

  /// The result card's footer actions, which report back on their own buttons.
  enum CardAction: Hashable {
    case save, copy, attach
  }

  /// What a footer action shows on its button (``cardFeedback(_:_:)``): a spinner while it runs
  /// (the button is off), then the orchestrator's short message with a check (`done`) or a
  /// warning (`failed`), until the button's label comes back after
  /// ``IslandShellFeedbackTiming/duration``.
  enum CardFeedback: Equatable {
    case working
    case done(String)
    case failed(String)
  }

  private(set) var showing: Showing?
  private unowned let progress: CommandProgressController
  private var statusToken = 0
  /// The result card's full-screen preview.
  let lightbox = IslandLightbox()

  init(progress: CommandProgressController) {
    self.progress = progress
    progress.island.model.recordingEvent = { [weak self] event in
      if event == .close { self?.closeCard() } else { self?.onEvent?(event) }
    }
  }

  private var island: IslandController { progress.island }

  /// The result card's state, kept for the recording it shows while the card is gone; nil
  /// before the first result.
  var card: RecordingCardState? { island.model.recordingCard?.state }

  // MARK: Showing

  /// The recording capsule with `capsule`'s values: in from whatever shows, or changed in place
  /// (as often as every 200 ms) with nothing measured or redrawn but its values.
  func showCapsule(_ capsule: RecordingCapsule) {
    let reserve = RecordingClock.reserved(for: island.model.recording.elapsed)
    island.model.recording = capsule
    guard showing != .capsule else {
      // Only a new hour digit grows the timer's reserved room.
      if RecordingClock.reserved(for: capsule.elapsed) != reserve {
        island.show(.recording, inPlace: true)
      }
      return
    }
    present(.capsule, .recording)
  }

  /// The discard confirmation, for a recording `elapsed` seconds long.
  func showDiscard(elapsed: Double) {
    present(.discard, .recordingDiscard(elapsed: RecordingClock.text(elapsed)))
  }

  /// The processing capsule: `message`, or the recording's own words for processing.
  func showProcessing(_ message: String? = nil) {
    let text = message ?? island.model.labels.recording.processing
    present(.processing, .recordingStatus(message: text, outcome: nil))
  }

  /// A check and `message` (saved, attached), or with `kind` ``StatusKind/failed`` a warning and
  /// why it could not be done, going by itself after ``statusDuration``.
  func showStatus(_ message: String, kind: StatusKind = .done) {
    guard present(.status, .recordingStatus(message: message, outcome: kind)) else { return }
    statusToken += 1
    let token = statusToken
    Task { [weak self] in
      try? await Task.sleep(for: Self.statusDuration)
      guard let self, token == statusToken, showing == .status else { return }
      release()
    }
  }

  /// The result card of `source`. The same recording shown again keeps its trim and answers;
  /// another one starts over.
  func showResult(_ source: RecordingCardSource) {
    let model: IslandRecordingCardModel
    if let kept = island.model.recordingCard, kept.source.id == source.id {
      model = kept
    } else {
      island.model.recordingCard?.close()
      model = IslandRecordingCardModel(RecordingCardState(source: source))
      wire(model)
    }
    model.reopen()
    island.model.recordingCard = model
    present(.result, .recordingResult)
  }

  /// Lets the kept result card go (a new recording begins, or its movie is gone): it can no
  /// longer be shown again, and its playback stops. A card still showing closes first, as its
  /// close button closes it but without ``IslandRecordingEvent/close``; called after
  /// ``showCapsule(_:)``, the card has already turned into the capsule instead.
  func forgetCard() {
    if showing == .result { release() }
    guard let model = island.model.recordingCard else { return }
    model.close()
    island.model.recordingCard = nil
  }

  /// Updates the displayed save folder name on the kept card, if one exists.
  func updateSaveFolder(_ folderName: String?) {
    island.model.recordingCard?.updateSaveFolder(folderName)
  }

  /// Restores keyboard focus to the lightbox or island window after a modal save panel closes.
  func restoreKeyboardAfterModal() {
    if lightbox.isOpen {
      lightbox.makeKeyIfVisible()
    } else if island.window.isVisible, island.window.canBecomeKey {
      island.window.makeKey()
    }
  }

  /// Shows `feedback` for the result card's `action` on that footer button, the card staying
  /// on the island; a kept card that does not show takes it too.
  func cardFeedback(_ action: CardAction, _ feedback: CardFeedback) {
    island.model.recordingCard?.feedback.show(feedback, for: action)
  }

  /// The page reported ask `askID` (`recording.answer`): `phase` with the answer's text so far.
  /// The card applies it whether or not it shows; an ask it no longer runs changes nothing.
  func updateAnswer(askID: String, phase: RecordingAnswer.Phase, text: String) {
    island.model.recordingCard?.asking.apply(askID: askID, phase: phase, text: text)
  }

  /// Takes the recording's content off the island; what the page shows draws again.
  func release() {
    guard let previous = showing else { return }
    showing = nil
    statusToken += 1
    if previous == .result { leaveCard() }
    progress.releaseShell()
  }

  /// Puts `content` on the island as `next`; false when the page's progress that waited under
  /// the hold took the island instead, which counts as replacing it.
  @discardableResult
  private func present(_ next: Showing, _ content: IslandContent) -> Bool {
    if showing == .result, next != .result {
      leaveCard()
      island.setKeyCapable(false)
    }
    showing = next
    statusToken += 1
    guard progress.showShell(content, by: .recording, holding: next != .status && next != .result)
    else {
      replaced()
      return false
    }
    return true
  }

  // MARK: The result card

  /// The page's progress, or the long screenshot's content, took the island from the recording.
  func replaced() {
    guard showing != nil else { return }
    let card = showing == .result
    showing = nil
    statusToken += 1
    if card { leaveCard() }
    if card { onResultReplaced?() }
  }

  /// The result card, or its lightbox, has the keyboard: a shortcut pressed now only closes it.
  var cardHasKeyboard: Bool {
    showing == .result && (island.window.isKeyWindow || lightbox.isKey)
  }

  /// A shortcut was pressed while the result card had the keyboard, or its close button or
  /// Escape closed it.
  func closeCard() {
    guard showing == .result else { return }
    release()
    onEvent?(.close)
  }

  /// Leaving the screen, the card stops an answer still coming and pauses.
  private func leaveCard() {
    lightbox.close(animated: false)
    guard let model = island.model.recordingCard else { return }
    model.asking.stopAnswer()
    model.pause()
  }

  private func wire(_ model: IslandRecordingCardModel) {
    model.onEvent = { [weak self] in self?.onEvent?($0) }
    model.onResize = { [weak self] in self?.resize() }
    model.openLightbox = { [weak self, weak model] in
      guard let model else { return }
      self?.openLightbox(model)
    }
    model.asking.writeClipboard = { [weak self] in
      self?.progress.arbiter.writeClipboard($0) ?? false
    }
  }

  /// The card's lightbox, from its player or its full-screen button; only while the card shows.
  private func openLightbox(_ model: IslandRecordingCardModel) {
    guard showing == .result, island.model.recordingCard === model,
      let screen = island.window.screen ?? NSScreen.main
    else { return }
    let labels = island.model.labels.recording
    lightbox.open(
      on: screen, from: island.screenRect(model.mediaFrame), returningKeyTo: island.window
    ) { lightbox in IslandRecordingLightbox(card: model, labels: labels, lightbox: lightbox) }
  }

  /// The card's size may have changed (an answer grew): the shape moves in place.
  private func resize() {
    guard showing == .result else { return }
    island.show(.recordingResult, inPlace: true)
  }

  // MARK: Keys

  /// A key press while the result card has the keyboard: true when it was taken. Escape ends an
  /// edit of the ask field, then stops an answer still coming, then closes the card; Space plays
  /// or pauses unless the field or a button has the keyboard focus (Full Keyboard Access presses
  /// a focused button with it), and the arrows nudge the focused handle
  /// (⇧ by a second) unless the field is being edited; ⌘C copies the kept range and ⌘↩ attaches
  /// it (``keyEquivalent(_:)``).
  func key(_ event: NSEvent) -> Bool {
    guard showing == .result, let card = island.model.recordingCard else { return false }
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
    case kVK_Space where field == nil && modifiers.isEmpty && !card.controlFocused:
      guard !event.isARepeat else { return true }
      card.togglePlay()
      return true
    case kVK_LeftArrow where field == nil && !card.controlFocused,
      kVK_RightArrow where field == nil && !card.controlFocused:
      guard modifiers.isEmpty || modifiers == .shift else { return false }
      return card.nudge(
        forward: Int(event.keyCode) == kVK_RightArrow, shift: modifiers == .shift)
    default:
      return false
    }
  }

  /// The footer's shortcuts while the card has the keyboard (``IslandShellFooterKey``): ⌘C
  /// copies the kept range, as Copy does, and ⌘↩ attaches it, as Attach to Conversation does.
  func keyEquivalent(_ event: NSEvent) -> Bool {
    guard showing == .result, let card = island.model.recordingCard,
      let key = IslandShellFooterKey(event, field: island.editingField)
    else { return false }
    switch key {
    case .save: card.onEvent(.save(card.state.trim))
    case .copy: card.onEvent(.copy(card.state.trim))
    case .attach: card.onEvent(.attach(card.state.trim))
    }
    return true
  }
}
