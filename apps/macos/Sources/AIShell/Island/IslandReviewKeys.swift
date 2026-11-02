import AICore
import AppKit
import Carbon.HIToolbox

/// What the review card's field and controls do.
enum IslandReviewEvent: Equatable {
  /// The field's text changed.
  case text(String)
  /// A suggested adjustment's chip: chosen, or taken back.
  case adjustment(String)
  /// A lone choice's value chip.
  case choice(key: String, value: String)
  /// The summary chip: the options sheet opens in the card's place.
  case options
  case showChanges(Bool)
  /// The send button (or Return): what was typed and staged goes as one adjustment.
  case send
  case regenerate
  /// The pager: the version to show.
  case version(Int)
}

extension ReviewChip {
  /// What a press of the chip does, by click or by Space while the keyboard highlights it.
  var event: IslandReviewEvent {
    switch self {
    case .value(let key, let value): .choice(key: key, value: value.value)
    case .summary: .options
    case .adjustment(let adjustment): .adjustment(adjustment)
    }
  }
}

/// The review card's keys, field, chips and options sheet, while the island shows a review
/// (contract: `commandProgress.show`'s answer with `review`). Everything the card stages stays
/// its own until it is sent (``ReviewDraft``); Regenerate, Version, Stop and the sent adjustment
/// leave the card up, and the page answers each with a show of the same target.
///
/// The island's window reads every key press before the field does. While the field has marked
/// text every key belongs to the input method. Return sends what is typed and staged (and does
/// nothing without either, or while a version is pending); ⌘Return and ⌥⌘Return write, as on the
/// answer card (``holdWriteKeys(_:)``); Escape peels one layer (``peelReview()``); ⌘R
/// regenerates; ⌘K opens the options sheet, as the summary chip does, whenever the version has
/// options; ⌘[ and ⌘] step to the previous and next version; ⌫ at the start of the field,
/// with nothing selected, takes back the last staged change; ⌘C copies the whole answer unless
/// the field or the answer has a selection, which it copies instead; ⌘V, ⌘X, ⌘A, ⌘Z and ⇧⌘Z edit
/// the field, as on the compose card, since the card's window has them while another app keeps
/// the menu bar.
///
/// The chip row is reached from the field without taking its caret, so the keys work whether or
/// not the system's keyboard navigation is on (``chipKey(_:modifiers:)``): ↓ or Tab highlights
/// the first chip and ⇧Tab the last (``IslandModel/reviewChip``); then ← and → move along the
/// row, Tab and ⇧Tab too and past its ends back to the field, ↑ goes back to the field, and Space
/// presses the chip as a click does, including opening the summary chip's options sheet. Return
/// always sends what is staged: Space picks a few, Return sends them. Done
/// on the sheet hands the keys back to the field, so the next Return sends what it staged; leaving
/// the sheet keeps the highlight on the summary chip. Escape takes the highlight away first. Any
/// other key takes it away and does what it does in the field, so typing goes on where it was.
///
/// The summary chip turns the card into the options sheet (``IslandCard`` with Done for Run,
/// its keys in ``IslandCardKeys``), whose values come back staged (``closeReviewSheet(staging:)``).
extension CommandProgressController {
  func wireReviewCard() {
    island.model.reviewEvent = { [weak self] event in self?.reviewEvent(event) }
  }

  /// The review card's options sheet is up in its place.
  var reviewSheetOpen: Bool { state.isReviewing && island.model.cardStages }

  /// `phase` is about to show for `target`. Another version of the review the card shows, or the
  /// review card coming back after its write was refused (``writingReview``), keeps what the card
  /// staged (``ReviewDraft/rebase(_:)``) and its options sheet, rebased the same way; any other
  /// review starts a new draft, and anything else takes the sheet away.
  func prepareReview(_ phase: CommandProgressState.Phase, target: String) {
    guard case .answer(_, _, _, let review?) = phase else {
      island.model.cardStages = false
      island.model.reviewChip = nil
      return
    }
    if state.shown?.target == target, state.isReviewing || writingReview == target {
      let before = island.model.review.values
      island.model.review.rebase(review.options)
      // An open options sheet follows the new version too, keeping only the values changed on it.
      if island.model.cardStages, var card = island.model.card {
        card.rebase(from: before, to: island.model.review.values)
        island.updateCard(card)
      }
      // The highlight keeps its place, which the new version's row has unless it is shorter.
      if let chip = island.model.reviewChip, chip >= review.chipRow.count {
        island.model.reviewChip = nil
      }
    } else {
      island.model.review = ReviewDraft(options: review.options)
      island.model.cardStages = false
      island.model.reviewChip = nil
    }
  }

  private func reviewEvent(_ event: IslandReviewEvent) {
    guard state.isReviewing, !island.model.cardStages else { return }
    switch event {
    // The field keeps one line, so typing never changes the card's size.
    case .text(let text): island.model.review.text = text
    case .adjustment(let adjustment):
      island.model.review.toggle(adjustment: adjustment)
      remeasureReview()
    case .choice(let key, let value):
      island.model.review.choose(value, for: key)
      remeasureReview()
    case .options: openReviewSheet()
    case .showChanges(let shows):
      island.model.review.showsChanges = shows
      remeasureReview()
    case .send: sendReview()
    case .regenerate: request(.regenerate)
    case .version(let version): request(.version, version: version)
    }
  }

  /// True when the review card took the key press or key equivalent `event`.
  func reviewKey(_ event: NSEvent) -> Bool {
    guard state.isReviewing, !island.model.cardStages, event.type == .keyDown else { return false }
    let field = island.editingField
    if field?.hasMarkedText() == true { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    let code = Int(event.keyCode)
    if chipKey(code, modifiers: modifiers) { return true }
    if [kVK_Return, kVK_ANSI_KeypadEnter].contains(code) {
      switch modifiers {
      case []: sendReview()
      // ⌘Return and ⌥⌘Return reach the card only where their hot keys could not be held.
      case .command: return writeFromKey(.primary)
      case [.option, .command]: return writeFromKey(.insert)
      default: return false
      }
      return true
    }
    switch (code, modifiers) {
    case (kVK_Escape, []):
      peelReview()
      return true
    case (kVK_Delete, []):
      guard let field, field.isEditable, field.selectedRange() == NSRange(location: 0, length: 0),
        island.model.review.removeLast()
      else { return false }
      remeasureReview()
      return true
    case (kVK_ANSI_LeftBracket, .command): step(by: -1)
    case (kVK_ANSI_RightBracket, .command): step(by: 1)
    default: return reviewCommand(event, modifiers: modifiers, field: field)
    }
    return true
  }

  /// True when the chip row took the key `code`: moving into it, along it or out of it, or
  /// pressing the highlighted chip. A key it leaves takes the highlight away, except Escape,
  /// which ``peelReview()`` takes it away with.
  private func chipKey(_ code: Int, modifiers: NSEvent.ModifierFlags) -> Bool {
    guard let row = state.reviewShown?.chipRow, !row.isEmpty else { return false }
    let tab = code == kVK_Tab && (modifiers.isEmpty || modifiers == .shift)
    guard let chip = island.model.reviewChip, row.indices.contains(chip) else {
      guard tab || (code == kVK_DownArrow && modifiers.isEmpty) else { return false }
      island.model.reviewChip = modifiers == .shift ? row.count - 1 : 0
      return true
    }
    if tab {
      let next = modifiers == .shift ? chip - 1 : chip + 1
      island.model.reviewChip = row.indices.contains(next) ? next : nil
      return true
    }
    switch (code, modifiers) {
    case (kVK_LeftArrow, []): island.model.reviewChip = max(chip - 1, 0)
    case (kVK_RightArrow, []): island.model.reviewChip = min(chip + 1, row.count - 1)
    case (kVK_UpArrow, []): island.model.reviewChip = nil
    // The row wraps, but the highlight only moves along it.
    case (kVK_DownArrow, []): break
    case (kVK_Space, []): reviewEvent(row[chip].event)
    default:
      if code != kVK_Escape { island.model.reviewChip = nil }
      return false
    }
    return true
  }

  /// ⌘R and the clipboard and editing commands, found by character so they work on any
  /// keyboard layout.
  private func reviewCommand(
    _ event: NSEvent, modifiers: NSEvent.ModifierFlags, field: NSTextView?
  ) -> Bool {
    guard let key = event.charactersIgnoringModifiers?.lowercased() else { return false }
    switch (modifiers, key) {
    case (.command, "r"): request(.regenerate)
    case (.command, "k"):
      guard state.reviewShown?.options.isEmpty == false else { return false }
      openReviewSheet()
    case (.command, "c"):
      if let field, field.selectedRange().length > 0 { field.copy(nil) } else { copyAnswer() }
    case (.command, "v"): field?.paste(nil)
    case (.command, "x"): field?.cut(nil)
    case (.command, "a"): field?.selectAll(nil)
    case (.command, "z"): field?.undoManager?.undo()
    case ([.command, .shift], "z"): field?.undoManager?.redo()
    default: return false
    }
    return true
  }

  private func writeFromKey(_ key: AnswerWriteOffer.Key) -> Bool {
    guard let mode = island.model.answerOffer?.write(for: key) else { return false }
    writeAnswer(mode)
    return true
  }

  /// Escape takes away one layer: the chips' highlight, then the typed text, then the staged
  /// changes, then the pending version (which stops), then the card itself.
  func peelReview() {
    let draft = island.model.review
    if island.model.reviewChip != nil {
      island.model.reviewChip = nil
    } else if !draft.text.isEmpty {
      island.model.review.text = ""
    } else if draft.count > 0 {
      island.model.review.clearStaged()
      remeasureReview()
    } else if state.reviewShown?.pending != nil {
      request(.stop)
    } else {
      press(.close)
    }
  }

  /// A card's field composing text owns Escape, which the Escape hot key caught first: it goes
  /// to the field's window, whose input method ends the composition. False when nothing composes.
  func forwardEscapeToInputMethod() -> Bool {
    guard island.window.isKeyWindow, let field = island.editingField, field.hasMarkedText(),
      let escape = NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: island.window.windowNumber,
        context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
        isARepeat: false, keyCode: UInt16(kVK_Escape))
    else { return false }
    island.window.sendEvent(escape)
    return true
  }

  /// Sends what the card holds as one adjustment, then starts the draft afresh (the switch for
  /// the changes stays); nothing, the draft kept, while the review takes no version (one is
  /// pending, or it has as many as it may make) or there is nothing to send.
  private func sendReview() {
    guard state.reviewShown?.takesVersion == true, let adjust = island.model.review.adjust,
      request(.adjust, adjust: adjust)
    else { return }
    island.model.review.text = ""
    island.model.review.clearStaged()
    island.model.reviewChip = nil
    remeasureReview()
  }

  /// The previous or next version, while there is one and none is pending.
  private func step(by delta: Int) {
    guard let review = state.reviewShown else { return }
    request(.version, version: review.version + delta)
  }

  /// The card changes in place, its shape following the chips' rows and the original.
  private func remeasureReview() {
    guard let shown = state.shown else { return }
    island.show(content(shown.phase), inPlace: true)
  }

  // MARK: The options sheet

  /// The options sheet takes the card's place, with the values the next version runs with.
  private func openReviewSheet() {
    guard case .answer(let command, _, _, .some) = state.shown?.phase else { return }
    island.model.cardStages = true
    island.updateCard(OptionsCard(options: island.model.review.values))
    island.show(.choose(command: command))
  }

  /// The sheet gives the review card its place back, with its values staged when it was done
  /// (`staging`, every option as the sheet left it) and unchanged when it was left. Done also
  /// gives the field the keys back, ready to type or send what was staged; leaving keeps the
  /// highlight where it was.
  func closeReviewSheet(staging options: [CommandOption]?) {
    guard reviewSheetOpen, let shown = state.shown else { return }
    if let options {
      island.model.review.stage(options)
      island.model.reviewChip = nil
    }
    island.model.cardStages = false
    island.show(content(shown.phase))
  }
}
