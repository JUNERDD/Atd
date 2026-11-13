import AICore
import AppKit
import Carbon.HIToolbox

/// The options card's keys, pointer and filter field, while the island is in its `choose` phase
/// (contract: the card's keyboard spec). The island's window reads every key press before the
/// filter field does: the keys the card takes (``OptionsCard/handle(_:)``) never reach the
/// field, the others type into it, and with no field to type into they go nowhere rather than
/// beep. While the field has marked text, every key belongs to the input method, so Return and
/// the digits confirm a composition instead of running.
///
/// The review card's options sheet is the same card, with Done for Run: Done (Return, or a pick
/// of a lone choice's value) takes the values back to the review card for its next version
/// (``closeReviewSheet(staging:)``), Escape goes back to it without them, and an input option,
/// which only the panel fills, hands the review to the panel as Open does.
///
/// The options card closes without running when the window gives up the keyboard to another
/// window (a click in another app): that app keeps the keyboard it took; the review card's sheet
/// stays, as the review card does. The compose card stays
/// with its draft instead, as the answer card does, so the person can copy something from that
/// app and come back to paste it: a click on the card gives it the keyboard again.
extension CommandProgressController {
  func wireCard() {
    // While the shell is on the island its result card reads the keys; the page's cards,
    // waiting in the state, read none.
    island.onKeyDown = { [weak self] event in
      guard let self else { return false }
      guard state.drawsProgress else { return shellKey(event) }
      return reviewKey(event) || answerKey(event) || composeKey(event) || cardKey(event)
    }
    island.onScroll = { [weak self] event in
      guard let self, state.drawsProgress else { return false }
      return cardScroll(event)
    }
    island.onResignKey = { [weak self] in
      guard let self, state.drawsProgress, state.isChoosing else { return }
      press(.cancel, returning: false)
    }
    island.model.cardEvent = { [weak self] event in self?.cardEvent(event) }
  }

  /// The options card is up: the `choose` phase's, or the review card's options sheet.
  private var showsCard: Bool { state.isChoosing || reviewSheetOpen }

  private func cardKey(_ event: NSEvent) -> Bool {
    guard showsCard, var card = island.model.card else { return false }
    let field = island.editingField
    if field?.hasMarkedText() == true { return false }
    guard let key = Self.key(event) else { return field == nil }
    let response = card.handle(key)
    if event.isARepeat {
      switch key {
      case .space, .enter, .escape, .digit:
        if response != .ignored { return true }
      default: break
      }
    }
    update(card)
    switch response {
    case .ignored: return field == nil
    case .handled: return true
    case .outcome(let outcome):
      finish(outcome, card: card)
      return true
    }
  }

  private func cardEvent(_ event: IslandCardEvent) {
    guard showsCard, var card = island.model.card else { return }
    switch event {
    case .hover(let row):
      card.hover(row)
      update(card)
    case .click(let row):
      let response = card.click(row)
      update(card)
      if case .outcome(let outcome) = response { finish(outcome, card: card) }
    case .run:
      let outcome = card.runButton()
      update(card)
      if let outcome { finish(outcome, card: card) }
    case .filter(let text):
      card.setFilter(text)
      update(card)
    }
  }

  /// Shows `card`. While choosing, a change of its choices or toggles goes to the page at once
  /// (``request(_:arguments:adjust:version:)``), which remembers it whether or not the card then runs; where the answer
  /// goes is never remembered, so a change of it alone sends nothing. The review card's sheet
  /// sends nothing: its values wait for the review card to send them.
  private func update(_ card: OptionsCard) {
    let shown = island.model.card?.arguments
    island.updateCard(card)
    let values = card.arguments
    if state.isChoosing, let shown,
      shown.choices != values.choices || shown.toggles != values.toggles
    {
      request(.pick, arguments: values)
    }
  }

  /// Escape on the review card's options sheet, which the Escape hot key brings here.
  func sheetEscape() {
    guard reviewSheetOpen, var card = island.model.card else { return }
    let response = card.handle(.escape)
    update(card)
    if case .outcome(let outcome) = response { finish(outcome, card: card) }
  }

  /// A scroll over the card moves its rows a row at a time.
  private func cardScroll(_ event: NSEvent) -> Bool {
    guard showsCard, var card = island.model.card else { return false }
    let points =
      event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 10
    let pitch = IslandMetrics.rowHeight + IslandMetrics.rowGap
    let rows = Int((-points / pitch).rounded())
    guard rows != 0 else { return true }
    card.scroll(by: rows)
    update(card)
    return true
  }

  private func finish(_ outcome: OptionsCard.Outcome, card: OptionsCard) {
    if reviewSheetOpen {
      switch outcome {
      case .run: closeReviewSheet(staging: card.options)
      case .close: closeReviewSheet(staging: nil)
      case .edit: press(.open)
      }
      return
    }
    switch outcome {
    case .run(let arguments): press(.run, arguments: arguments)
    case .edit(let arguments): press(.edit, arguments: arguments)
    case .close: press(.cancel)
    }
  }

  /// The card's key for a key press, or nil for a key it never reads.
  private static func key(_ event: NSEvent) -> OptionsCard.Key? {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch Int(event.keyCode) {
    case kVK_UpArrow: return modifiers.isEmpty ? .up : nil
    case kVK_DownArrow: return modifiers.isEmpty ? .down : nil
    case kVK_LeftArrow: return modifiers.isEmpty ? .left : nil
    case kVK_RightArrow: return modifiers.isEmpty ? .right : nil
    case kVK_Tab: return modifiers == .shift ? .backTab : modifiers.isEmpty ? .tab : nil
    case kVK_Space: return modifiers.isEmpty ? .space : nil
    case kVK_Return, kVK_ANSI_KeypadEnter: return modifiers.isEmpty ? .enter : nil
    case kVK_Escape: return .escape
    case kVK_Delete: return modifiers.isEmpty ? .delete : nil
    case kVK_ANSI_LeftBracket where modifiers == .command: return .back
    default: break
    }
    guard modifiers.isEmpty || modifiers == .shift,
      let character = event.charactersIgnoringModifiers, character.count == 1,
      let digit = Int(character), (1...9).contains(digit)
    else { return nil }
    return .digit(digit)
  }
}
