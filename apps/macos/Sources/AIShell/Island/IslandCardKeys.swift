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
/// The options card closes without running when the window gives up the keyboard to another
/// window (a click in another app): that app keeps the keyboard it took. The compose card stays
/// with its draft instead, as the answer card does, so the person can copy something from that
/// app and come back to paste it: a click on the card gives it the keyboard again.
extension CommandProgressController {
  func wireCard() {
    island.onKeyDown = { [weak self] event in
      guard let self else { return false }
      return answerKey(event) || composeKey(event) || cardKey(event)
    }
    island.onScroll = { [weak self] event in self?.cardScroll(event) ?? false }
    island.onResignKey = { [weak self] in
      guard let self, state.isChoosing else { return }
      press(.cancel, returning: false)
    }
    island.model.cardEvent = { [weak self] event in self?.cardEvent(event) }
  }

  private func cardKey(_ event: NSEvent) -> Bool {
    guard state.isChoosing, var card = island.model.card else { return false }
    let field = island.editingField
    if field?.hasMarkedText() == true { return false }
    guard let key = Self.key(event) else { return field == nil }
    let response = card.handle(key)
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
    guard state.isChoosing, var card = island.model.card else { return }
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

  /// Shows `card`. A change of its choices or toggles goes to the page at once (``picked(_:)``),
  /// which remembers it whether or not the card then runs; where the answer goes is never
  /// remembered, so a change of it alone sends nothing.
  private func update(_ card: OptionsCard) {
    let shown = island.model.card?.arguments
    island.updateCard(card)
    let values = card.arguments
    if let shown, shown.choices != values.choices || shown.toggles != values.toggles {
      picked(values)
    }
  }

  /// A scroll over the card moves its rows a row at a time.
  private func cardScroll(_ event: NSEvent) -> Bool {
    guard state.isChoosing, var card = island.model.card else { return false }
    let points =
      event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 10
    let rows = Int((-points / IslandMetrics.rowHeight).rounded())
    guard rows != 0 else { return true }
    card.scroll(by: rows)
    update(card)
    return true
  }

  private func finish(_ outcome: OptionsCard.Outcome, card: OptionsCard) {
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
