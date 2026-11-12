import AICore
import AppKit
import Carbon.HIToolbox

/// The keyboard the island takes and gives back, and Escape while it belongs to the island
/// (``CommandProgressController``'s keys).
extension CommandProgressController {
  /// Escape held exactly while a run is working or the answer card shows; the keyboard taken
  /// while a card is up (unless `taking` is false: the card only goes on as it was, an answer
  /// streaming in, which leaves the keyboard where the person put it) and given back to
  /// `leavingCard`'s field once it is gone. A registration that fails leaves the close button as
  /// the only way to cancel.
  func sync(leavingCard: String?, taking: Bool = true) {
    guard state.drawsProgress else { return yieldKeys() }
    settleReviewNotice()
    if state.takesKeyboard {
      island.setKeyCapable(true, taking: taking)
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

  /// Escape: a card's field composing text hands it to the input method; the review card's
  /// options sheet goes back a step, and the review card peels a layer (``peelReview()``); an
  /// answer streaming in stops, keeping the card; the answer card closes, as its close button
  /// does; a working run is cancelled.
  private func escapePressed() {
    if forwardEscapeToInputMethod() { return }
    if reviewSheetOpen {
      sheetEscape()
    } else if state.isReviewing {
      peelReview()
    } else if state.answerStreams {
      request(.stop)
    } else if let shown = state.shown, state.isAnswering {
      hide(target: shown.target)
    } else {
      press(.cancel)
    }
  }
}
