import AICore
import AppKit
import Carbon.HIToolbox

/// The answer card's keys, while the island is in its `answer` phase and has the keyboard
/// (contract: `commandProgress.show`'s answer card). Escape closes the card, as its close
/// button does. ⌘C copies the whole answer, as Copy does, unless some of the answer is selected:
/// the selection is copied then, the usual way. Both arrive as key presses or, ⌘C usually, as
/// key equivalents ahead of the menus (``IslandWindow/onKeyEquivalent``); every other key goes
/// on as usual. Return performs the primary write; ⌘Return and ⌥⌘Return are hot keys held while
/// the card offers a write (``holdWriteKeys(_:)``), so they work from the field the person
/// clicked into as well.
///
/// Unlike the options card, the answer card stays when the window gives up the keyboard (a
/// click in another app): it never goes by itself, and a click on it takes the keyboard again.
extension CommandProgressController {
  func wireAnswerCard() {
    answerFocus.onChange = { [weak self] offer in self?.answerOfferChanged(offer) }
    island.onKeyEquivalent = { [weak self] event in
      guard let self else { return false }
      return answerKey(event) || composeKeyEquivalent(event)
    }
  }

  /// True when the answer card took `event`.
  func answerKey(_ event: NSEvent) -> Bool {
    guard state.isAnswering, event.type == .keyDown else { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    if Int(event.keyCode) == kVK_Escape, modifiers.isEmpty {
      guard let target = state.shown?.target else { return false }
      hide(target: target)
      return true
    }
    // Return writes the primary of Insert and Replace while the card offers them; ⌘Return and
    // ⌥⌘Return reach the card here only where their hot keys could not be held.
    if [kVK_Return, kVK_ANSI_KeypadEnter].contains(Int(event.keyCode)) {
      let key: AnswerWriteOffer.Key? =
        switch modifiers {
        case [], .command: .primary
        case [.option, .command]: .insert
        default: nil
        }
      guard let key, let mode = island.model.answerOffer?.write(for: key) else { return false }
      writeAnswer(mode)
      return true
    }
    // By character, so ⌘C is found on any keyboard layout.
    guard modifiers == .command, event.charactersIgnoringModifiers?.lowercased() == "c",
      !answerHasSelection
    else { return false }
    copyAnswer()
    return true
  }

  /// Holds ⌘Return and ⌥⌘Return while the card offers `offer`, for whichever writes it has, and
  /// lets them go with the offer; one another app already holds is left to the card's own keys.
  func holdWriteKeys(_ offer: AnswerWriteOffer?) {
    for token in writeKeys { keys.unregister(token) }
    writeKeys = []
    guard let offer else { return }
    let combinations: [(AnswerWriteOffer.Key, HotKeyModifiers)] =
      [(.primary, [.command]), (.insert, [.option, .command])]
    for (key, modifiers) in combinations where offer.write(for: key) != nil {
      let combination = HotKeyCombination(keyCode: UInt32(kVK_Return), modifiers: modifiers)
      if case .success(let token) = keys.register(
        combination,
        onPress: { [weak self] in
          guard let self, state.isAnswering,
            let mode = island.model.answerOffer?.write(for: key)
          else { return }
          writeAnswer(mode)
        })
      {
        writeKeys.append(token)
      }
    }
  }

  /// Some of the answer is selected: the answer's text field has the keyboard with a selection.
  private var answerHasSelection: Bool {
    guard let field = island.editingField else { return false }
    return field.selectedRange().length > 0
  }
}
