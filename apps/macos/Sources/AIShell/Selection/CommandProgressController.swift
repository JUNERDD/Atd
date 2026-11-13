import AICore
import AppKit

/// The command island of a command that writes its answer back without the panel
/// (`commandProgress.show`, `.hide`, and `text.write`), drawn by ``IslandController``:
///
/// - press: a command shortcut whose command has options is held past ``CommandHold/reveal``
///   (``showPress(command:)``); it charges toward the options card and, once the launch went to
///   the page, waits ``CommandHold/pageWait`` for the page to show something before it leaves;
/// - working: the command's name shimmering, its values chip when it has options (a click asks
///   the page to stop the run and reopen its options), the hint that Escape cancels, and a close
///   button that cancels;
/// - choose: the options card, which takes the keyboard (``IslandCardKeys``);
/// - writing and done: the shell's own while `text.write` types the answer in, done going by
///   itself after ``CommandProgressState/doneDuration``;
/// - notice: the page's message, Open, and a close button that only dismisses; it goes by itself
///   after ``CommandProgressState/noticeDuration``;
/// - answer: the run's answer where it could not be written, as a card that takes the keyboard
///   (``IslandAnswerCard``, its keys in ``answerKey(_:)``): Copy puts the answer on the clipboard
///   and shows "Copied" until ``CommandProgressState/doneDuration`` passes, Open hands the run to
///   the panel, and close only dismisses; while the person's focus is a field that can take text,
///   Insert and Replace write the answer there (``writeAnswer(_:)``); it stays until it is acted
///   on or replaced; with a review it is the review card (``IslandReviewCard``, its keys and
///   staging in ``reviewKey(_:)``), which asks the page for versions and tells it `close` once it
///   goes by itself;
/// - compose: a command launched with nothing selected asks for its text, and attachments when
///   it takes files, as a card that takes the keyboard (``IslandComposeCard``, its keys in
///   ``composeKey(_:)``, attaching through ``ComposeAttachments``): Run turns it into the run as
///   the options card's does, Open hands what was typed to the panel, close or Escape cancels.
///
/// Presses reach the page as `commandProgress.action`. Escape belongs to the island only while a
/// run is working, where it cancels the run instead of reaching the app the answer will be
/// written into, and while the answer card shows, where it closes the card (or stops its answer
/// while it streams in) even after the person clicked into another app to insert there: a
/// temporary hot key, registered then and gone with those phases, as the answer card's write keys
/// are (``holdWriteKeys(_:)``); its registrations carry their own signature, apart from the global
/// shortcuts' (``CarbonHotKeys``). The other cards read Escape themselves, as the key window.
/// The selection toolbar's listening HUD shares the bottom-centre place, so it yields while the
/// island is on screen.
final class CommandProgressController: NSObject {
  /// 'AIES'
  private static let escapeSignature: OSType = 0x4149_4553

  private let panel: WebViewHost
  let island = IslandController()
  let keys = CarbonHotKeys(signature: CommandProgressController.escapeSignature)
  /// Written by this controller and its recording gate (``CommandProgressController+Recording``).
  var state = CommandProgressState()
  /// Escape's registration while it belongs to the island.
  var escape: UInt32?
  /// The press island shows, ahead of anything the page shows.
  private(set) var pressing = false
  /// Bumped by every change, so a timer of an earlier one never acts on a later one.
  private var timer = 0
  /// Gives the keyboard back to the field the write target `target` names.
  let returnFocus: (String) -> Void
  /// The shell's screenshot and file picking, which the compose card attaches from.
  let attachments: ComposeAttachments
  /// The compose card is attaching: a capture session or the open panel has the keyboard, so
  /// the card neither runs nor starts another attach until it is back.
  var attaching = false
  /// Where the person's focus is while the answer card shows, for its Insert and Replace.
  let answerFocus = AnswerFocusWatch()
  /// The shell's own write of the answer card's answer into the focused field.
  let answerWriter: AnswerWriter
  let answerWriteHandoff = KeyboardHandoff()
  /// Claims the clipboard for Copy and for the answer a stopped write leaves there.
  let arbiter: DeviceArbiter
  /// The answer card's write hot keys, held while it offers a write (``holdWriteKeys(_:)``).
  var writeKeys: [UInt32] = []
  /// The target whose review card an Insert or Replace took away while its write runs: a refused
  /// write brings that card back with what it staged (``prepareReview(_:target:)``).
  var writingReview: String?
  /// The review cards the page was told to let go, and the one it will be once its notice goes.
  var reviewClosings = ReviewClosings()
  /// The shell's screen recording and long screenshot, which share the island in turn (their
  /// gate: ``CommandProgressController+Recording``).
  lazy var recording = IslandRecording(progress: self)
  lazy var longScreenshot = IslandLongScreenshot(progress: self)

  init(
    _ panel: WebViewHost, toolbar: SelectionToolbarController,
    returnFocus: @escaping (String) -> Void, attachments: ComposeAttachments,
    answerWriter: @escaping AnswerWriter, arbiter: DeviceArbiter
  ) {
    self.panel = panel
    self.returnFocus = returnFocus
    self.attachments = attachments
    self.answerWriter = answerWriter
    self.arbiter = arbiter
    super.init()
    island.onVisibilityChange = { [weak toolbar] visible in toolbar?.hudYields(visible) }
    island.model.act = { [weak self] action in self?.act(action) }
    wireCard()
    wireAnswerCard()
    wireComposeCard()
    wireReviewCard()
    DispatchQueue.main.async { [weak self] in
      guard let self, !NSScreen.screens.isEmpty else { return }
      self.island.warmUp()
    }
  }

  /// Shows `params.state` for its target, replacing the island of another target; one of the
  /// same target changes in place.
  func show(_ params: CommandProgressShowParams) throws(BridgeError) {
    guard let phase = CommandProgressState.phase(params.state) else {
      throw BridgeError("The progress has nothing to show.")
    }
    if isStale(phase, target: params.target) { return }
    present(target: params.target, phase: phase)
  }

  /// Takes the island of `target` away; one of another target stays.
  func hide(target: String) {
    let keyboard = state.takesKeyboard
    guard state.hide(target: target) else { return }
    sync(leavingCard: keyboard ? target : nil)
    if !pressing, state.drawsProgress { exitIsland() }
  }

  /// `text.write` is typing the answer for `target` in. Only over nothing or `target`'s own
  /// island: another target's island, or a shortcut's press capsule, stays as it is.
  func showWriting(target: String) {
    guard !pressing, state.letsShellShow(for: target) else { return }
    present(target: target, phase: .writing)
  }

  /// `text.write` wrote the answer for `target`, under the same rule as ``showWriting(target:)``.
  func showDone(target: String) {
    guard !pressing, state.letsShellShow(for: target) else { return }
    present(target: target, phase: .done)
  }

  /// A command shortcut with options is held. An outcome still up (a notice, "Written",
  /// "Copied", an answer card, which gives the keyboard back) gives way; a run still working
  /// comes back if the page shows nothing for this launch.
  func showPress(command: String) {
    guard progressMayShow() else { return }
    if let shown = state.shown, state.givesWayToPress {
      let keyboard = state.takesKeyboard
      if let leaving = state.leaving { send(leaving) }
      state.hide(target: shown.target)
      sync(leavingCard: keyboard ? shown.target : nil)
    }
    pressing = true
    timer += 1
    island.show(.press(command: command))
  }

  /// The pressed command went to the page: unless the page shows something within
  /// ``CommandHold/pageWait``, the press island goes (the panel opened instead, say).
  func pressDelivered() {
    guard pressing else { return }
    let token = timer
    Task { [weak self] in
      try? await Task.sleep(for: CommandHold.pageWait)
      guard let self, token == timer else { return }
      endPress()
    }
  }

  /// The task panel came onto the screen: a press capsule still up waits for nothing more (the
  /// page took the command to the panel), so it goes at once rather than over the panel.
  func panelShown() { endPress() }

  /// The press capsule gives way to what the state shows, or the island leaves.
  private func endPress() {
    guard pressing else { return }
    pressing = false
    timer += 1
    drawProgress()
  }

  /// Shows `phase` for `target`. A card leaving gives the keyboard back to its target's field
  /// unless `returningFocus` is false (an Insert or Replace, which writes where the focus is).
  /// What follows an answer streaming in for the same target (more of it, or its end) changes the
  /// card in place, as the stream itself does, without taking the keyboard back from where the
  /// person put it meanwhile.
  func present(
    target: String, phase: CommandProgressState.Phase, returningFocus: Bool = true
  ) {
    let leaving = state.takesKeyboard ? state.shown?.target : nil
    let streamed = state.answerStreams
    let inPlace = streamed && state.shown?.target == target
    if case .choose(_, let options, let output) = phase, state.shown?.phase != phase {
      let names = CommandOutputChoice.Names(ShellStrings.shared.catalog)
      island.updateCard(
        OptionsCard(options: CommandOutputChoice.appending(output, to: options, names: names)))
    }
    // The draft stays only while the card shows for the same target; any other way in starts
    // a new one.
    if case .compose = phase, !state.isComposing || state.shown?.target != target {
      island.model.compose = ComposeDraft()
    }
    prepareReview(phase, target: target)
    pressing = false
    state.show(target: target, phase: phase)
    timer += 1
    let draws = progressMayShow()
    if draws, state.takesKeyboard, island.window.isVisible {
      island.setKeyCapable(true, taking: !inPlace)
    }
    if draws { island.show(content(phase), inPlace: inPlace) }
    sync(leavingCard: state.takesKeyboard || !returningFocus ? nil : leaving, taking: !inPlace)
    // The writes' keys wait while the answer streams in.
    if streamed != state.answerStreams { holdWriteKeys(island.model.answerOffer) }
    if draws { expire() }
  }

  /// What the island shows for `phase`.
  func content(_ phase: CommandProgressState.Phase) -> IslandContent {
    switch phase {
    case .working(let command, let summary): .working(command: command, summary: summary)
    case .choose(let command, _, _): .choose(command: command)
    case .writing: .writing
    case .done: .done
    case .notice(let message): .notice(message: message)
    case .answer(let command, _, _, .some, _) where island.model.cardStages:
      .choose(command: command)
    case .answer(let command, let answer, let note, let review?, _):
      .review(command: command, answer: answer, note: note, review: review)
    case .answer(let command, let answer, let note, nil, let streaming):
      .answer(
        command: command, answer: IslandAnswer(text: answer, streaming: streaming), note: note)
    case .copied: .copied
    case .compose(let command, let attach): .compose(command: command, attach: attach)
    }
  }

  /// What shows goes by itself once its ``CommandProgressState/lifetime(_:)`` passes, counted
  /// from now (it just drew), unless anything changed meanwhile.
  func expire() {
    timer += 1
    guard let shown = state.shown, let lifetime = CommandProgressState.lifetime(shown.phase)
    else { return }
    let token = timer
    Task { [weak self] in
      try? await Task.sleep(for: lifetime)
      guard let self, token == timer, state.drawsProgress else { return }
      hide(target: shown.target)
    }
  }

  // MARK: Presses

  private func act(_ action: IslandAction) {
    switch action {
    case .cancel: press(.cancel)
    case .open: press(.open)
    case .change: press(.change)
    case .dismiss:
      guard let shown = state.shown else { return }
      if state.isReviewing {
        press(.close)
      } else if state.answerStreams {
        press(.cancel)
      } else {
        hide(target: shown.target)
      }
    case .stop: request(.stop)
    case .copy: copyAnswer()
    case .write(let mode): writeAnswer(mode)
    }
  }

  /// A card has the keyboard, so a summon would read Atd's own window: the options card, or the
  /// answer or compose card while its window is key (each stays up, without the keyboard, once
  /// the person moved on, or while a screenshot or the open panel attaches for the compose card).
  var cardHasKeyboard: Bool {
    guard state.drawsProgress else { return shellCardHasKeyboard }
    return state.isChoosing
      || ((state.isAnswering || state.isComposing) && island.window.isKeyWindow)
  }

  /// A shortcut pressed while a card has the keyboard closes it, giving the keyboard back: the
  /// options card and the compose card cancel their command, the review card closes, an answer
  /// still streaming in cancels its run, any other answer card only goes.
  func closeCard() {
    if !state.drawsProgress {
      closeShellCard()
    } else if state.isReviewing {
      press(.close)
    } else if state.isChoosing || state.isComposing || state.answerStreams {
      press(.cancel)
    } else if let shown = state.shown, state.isAnswering {
      hide(target: shown.target)
    }
  }

  /// Sends `action` for the island shown, with the options card's values for Run and Edit, or
  /// what the compose card holds for Run and Open (`compose`). The island
  /// shows what the state has after it, or leaves. The keyboard goes back to the target's
  /// field when a card closes, unless `returning` is false (another window took it) or the
  /// panel takes over (Edit, and Open on an answer card).
  func press(
    _ action: CommandProgressActionEvent.Action, arguments: CommandArguments? = nil,
    compose: CommandProgressActionEvent.Compose? = nil, returning: Bool = true
  ) {
    let choosing = state.takesKeyboard ? state.shown?.target : nil
    guard let event = state.press(action, arguments: arguments, compose: compose) else { return }
    timer += 1
    let panelTakes = action == .edit || action == .open
    // Open on an interrupted review write's notice hands the review over instead of closing it.
    if panelTakes { reviewClosings.notice = nil }
    sync(leavingCard: returning && !panelTakes ? choosing : nil)
    if choosing != nil { island.setKeyCapable(false) }
    drawProgress()
    send(event)
  }

  /// Sends `action` when the island shown offers it, the island staying as it is: the options
  /// card's changed values (`pick` with every value it shows, which the page remembers at once)
  /// and the review card's requests. False when it offers nothing for it.
  @discardableResult
  func request(
    _ action: CommandProgressActionEvent.Action, arguments: CommandArguments? = nil,
    adjust: CommandProgressActionEvent.Adjust? = nil, version: Int? = nil
  ) -> Bool {
    guard let event = state.press(action, arguments: arguments, adjust: adjust, version: version)
    else { return false }
    send(event)
    return true
  }

  /// Sends `event` to the page, the island staying as it is.
  func send(_ event: CommandProgressActionEvent) {
    noteSent(event)
    panel.send(.commandProgressAction(event), scope: .document)
  }
}
