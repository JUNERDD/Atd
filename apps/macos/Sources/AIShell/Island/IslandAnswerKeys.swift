import AICore
import AppKit
import Carbon.HIToolbox

/// The answer card's keys, while the island is in its `answer` phase and has the keyboard
/// (contract: `commandProgress.show`'s answer card). Escape closes the card, as its close
/// button does. ⌘C copies the whole answer, as Copy does, unless some of the answer is selected:
/// the selection is copied then, the usual way. Both arrive as key presses or, ⌘C usually, as
/// key equivalents ahead of the menus (``IslandWindow/onKeyEquivalent``); every other key goes
/// on as usual.
///
/// Unlike the options card, the answer card stays when the window gives up the keyboard (a
/// click in another app): it never goes by itself, and a click on it takes the keyboard again.
extension CommandProgressController {
  func wireAnswerCard() {
    island.onKeyEquivalent = { [weak self] event in self?.answerKey(event) ?? false }
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
    // By character, so ⌘C is found on any keyboard layout.
    guard modifiers == .command, event.charactersIgnoringModifiers?.lowercased() == "c",
      !answerHasSelection
    else { return false }
    copyAnswer()
    return true
  }

  /// Some of the answer is selected: the answer's text field has the keyboard with a selection.
  private var answerHasSelection: Bool {
    guard let field = island.editingField else { return false }
    return field.selectedRange().length > 0
  }
}
