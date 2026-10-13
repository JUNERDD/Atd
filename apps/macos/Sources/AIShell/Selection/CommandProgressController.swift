import AICore
import AppKit
import Carbon.HIToolbox

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
///   on or replaced;
/// - compose: a command launched with nothing selected asks for its text, and attachments when
///   it takes files, as a card that takes the keyboard (``IslandComposeCard``, its keys in
///   ``composeKey(_:)``, attaching through ``ComposeAttachments``): Run turns it into the run as
///   the options card's does, Open hands what was typed to the panel, close or Escape cancels.
///
/// Presses reach the page as `commandProgress.action`. Escape belongs to the island only while a
/// run is working, where it cancels the run instead of reaching the app the answer will be
/// written into, and while the answer card shows, where it closes the card even after the person
/// clicked into another app to insert there: a temporary hot key, registered then and gone with
/// those phases, as the answer card's write keys are (``holdWriteKeys(_:)``); its registrations
/// carry their own signature, apart from the global shortcuts' (``CarbonHotKeys``). The other
/// cards read Escape themselves, as the key window. The selection toolbar's listening
/// HUD shares the bottom-centre place, so it yields while the island is on screen.
final class CommandProgressController: NSObject {
  /// 'AIES'
  private static let escapeSignature: OSType = 0x4149_4553

  private let panel: WebViewHost
  let island = IslandController()
  let keys = CarbonHotKeys(signature: CommandProgressController.escapeSignature)
  private(set) var state = CommandProgressState()
  private var escape: UInt32?
  /// The press island shows, ahead of anything the page shows.
  private var pressing = false
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
  /// The answer card's write hot keys, held while it offers a write (``holdWriteKeys(_:)``).
  var writeKeys: [UInt32] = []

  init(
    _ panel: WebViewHost, toolbar: SelectionToolbarController,
    returnFocus: @escaping (String) -> Void, attachments: ComposeAttachments,
    answerWriter: @escaping AnswerWriter
  ) {
    self.panel = panel
    self.returnFocus = returnFocus
    self.attachments = attachments
    self.answerWriter = answerWriter
    super.init()
    island.onVisibilityChange = { [weak toolbar] visible in toolbar?.hudYields(visible) }
    island.model.act = { [weak self] action in self?.act(action) }
    wireCard()
    wireAnswerCard()
    wireComposeCard()
  }

  /// Shows `params.state` for its target, replacing the island of another target; one of the
  /// same target changes in place.
  func show(_ params: CommandProgressShowParams) throws(BridgeError) {
    guard let phase = CommandProgressState.phase(params.state) else {
      throw BridgeError("The progress has nothing to show.")
    }
    present(target: params.target, phase: phase)
  }

  /// Takes the island of `target` away; one of another target stays.
  func hide(target: String) {
    let keyboard = state.takesKeyboard
    guard state.hide(target: target) else { return }
    sync(leavingCard: keyboard ? target : nil)
    if !pressing { island.exit() }
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
    if let shown = state.shown, state.givesWayToPress {
      let keyboard = state.takesKeyboard
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
    if let shown = state.shown { island.show(content(shown.phase)) } else { island.exit() }
  }

  /// Shows `phase` for `target`. A card leaving gives the keyboard back to its target's field
  /// unless `returningFocus` is false (an Insert or Replace, which writes where the focus is).
  func present(
    target: String, phase: CommandProgressState.Phase, returningFocus: Bool = true
  ) {
    let leaving = state.takesKeyboard ? state.shown?.target : nil
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
    pressing = false
    state.show(target: target, phase: phase)
    timer += 1
    island.show(content(phase))
    sync(leavingCard: state.takesKeyboard || !returningFocus ? nil : leaving)
    switch phase {
    case .notice: expire(target: target, after: CommandProgressState.noticeDuration)
    case .done, .copied: expire(target: target, after: CommandProgressState.doneDuration)
    default: break
    }
  }

  /// What the island shows for `phase`.
  func content(_ phase: CommandProgressState.Phase) -> IslandContent {
    switch phase {
    case .working(let command, let summary): .working(command: command, summary: summary)
    case .choose(let command, _, _): .choose(command: command)
    case .writing: .writing
    case .done: .done
    case .notice(let message): .notice(message: message)
    case .answer(let command, let answer, let note):
      .answer(command: command, answer: answer, note: note)
    case .copied: .copied
    case .compose(let command, let attach): .compose(command: command, attach: attach)
    }
  }

  /// Takes the island of `target` away after `duration`, unless anything changed meanwhile.
  private func expire(target: String, after duration: Duration) {
    let token = timer
    Task { [weak self] in
      try? await Task.sleep(for: duration)
      guard let self, token == timer else { return }
      hide(target: target)
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
      hide(target: shown.target)
    case .copy: copyAnswer()
    case .write(let mode): writeAnswer(mode)
    }
  }

  /// A card has the keyboard, so a summon would read Atd's own window: the options card, or the
  /// answer or compose card while its window is key (each stays up, without the keyboard, once
  /// the person moved on, or while a screenshot or the open panel attaches for the compose card).
  var cardHasKeyboard: Bool {
    state.isChoosing || ((state.isAnswering || state.isComposing) && island.window.isKeyWindow)
  }

  /// A shortcut pressed while a card has the keyboard closes it, giving the keyboard back: the
  /// options card and the compose card cancel their command, the answer card only goes.
  func closeCard() {
    if state.isChoosing || state.isComposing {
      press(.cancel)
    } else if let shown = state.shown, state.isAnswering {
      hide(target: shown.target)
    }
  }

  /// Copy on the answer card: the whole answer goes on the clipboard as plain text, and the
  /// card turns into "Copied", giving the keyboard back to the target's field.
  func copyAnswer() {
    guard let target = state.shown?.target, let answer = state.answerShown else { return }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(answer, forType: .string)
    present(target: target, phase: .copied)
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
    sync(leavingCard: returning && !panelTakes ? choosing : nil)
    if choosing != nil { island.setKeyCapable(false) }
    if let shown = state.shown { island.show(content(shown.phase)) } else { island.exit() }
    panel.send(.commandProgressAction(event), scope: .document)
  }

  /// The options card's choices or toggles changed to `arguments` (every value it shows): the
  /// page remembers them at once, and the card stays as it is.
  func picked(_ arguments: CommandArguments) {
    guard let event = state.press(.pick, arguments: arguments) else { return }
    panel.send(.commandProgressAction(event), scope: .document)
  }

  /// Escape held exactly while a run is working or the answer card shows; the keyboard taken
  /// while a card is up and given back to `leavingCard`'s field once it is gone. A registration
  /// that fails leaves the close button as the only way to cancel.
  private func sync(leavingCard: String?) {
    if state.takesKeyboard {
      island.setKeyCapable(true)
    } else if let leavingCard {
      island.setKeyCapable(false)
      returnFocus(leavingCard)
    }
    followAnswerFocus()
    if state.cancelsWithEscape || state.isAnswering {
      guard escape == nil else { return }
      let combination = HotKeyCombination(keyCode: UInt32(kVK_Escape), modifiers: [])
      if case .success(let token) = keys.register(
        combination, onPress: { [weak self] in self?.escapePressed() })
      {
        escape = token
      }
    } else if let token = escape {
      keys.unregister(token)
      escape = nil
    }
  }

  /// Escape: the answer card closes, as its close button does; a working run is cancelled.
  private func escapePressed() {
    if let shown = state.shown, state.isAnswering {
      hide(target: shown.target)
    } else {
      press(.cancel)
    }
  }
}
