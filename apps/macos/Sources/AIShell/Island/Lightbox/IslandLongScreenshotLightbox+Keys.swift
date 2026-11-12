import AICore
import AppKit
import Carbon.HIToolbox

/// The full-screen preview's keys, by mode:
///
/// - View: ↑ ↓ scroll by 90 pt (or nudge a pressed trim bar, ⇧ by 100 pt), Page Up and Page
///   Down go a page, + = − zoom by a step, 0 switches Fit ⇄ 100%, Space closes.
/// - Text: the same, but Space held pans (a drag moves the image rather than drawing a marquee)
///   and never closes.
/// - Annotate: Escape steps back in the editor, then leaves annotate mode; every other key goes
///   on to the canvas.
///
/// Outside annotate mode Escape steps back one thing at a time: a marquee being dragged, the
/// options menu, a command running (its answer or the version it makes stops), the side panel
/// while it is a drawer (a docked one is a view, not a step), the picks, then text mode; Escape
/// not taken closes the lightbox. ⌘A picks every available paragraph, ⌘C copies the picked text
/// (or the card's answer while the side panel shows it, else the kept image), ⌘↩ applies a review
/// the panel shows (else attaches the kept image), ⌘Z and ⇧⌘Z undo and redo what is on the image,
/// and ⌥ held peeks at the original under the replacements. ⌥⌘I shows or hides the side panel in
/// every mode, even while the result card's field has the keyboard, which keeps every other key
/// but Escape.
extension IslandLongScreenshotLightbox {
  func key(_ event: NSEvent) -> Bool {
    guard live else { return false }
    let code = Int(event.keyCode)
    if fieldFocused {
      guard code == kVK_Escape else { return false }
      annotator.canvas.window?.makeFirstResponder(nil)
      return true
    }
    if annotating {
      guard code == kVK_Escape else { return false }
      if !annotator.stepBack() { setAnnotating(false) }
      return true
    }
    if code == kVK_Escape { return escape() }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard modifiers.isEmpty || modifiers == .shift else { return false }
    let plain = modifiers.isEmpty
    switch code {
    case kVK_UpArrow, kVK_DownArrow:
      guard !controlFocused else { return false }
      let down = code == kVK_DownArrow
      if card.nudge(down: down, shift: !plain) { return true }
      viewer.scroll(by: (down ? 1 : -1) * LongScreenshotLightboxLayout.arrowScroll)
    case kVK_PageUp where plain, kVK_PageDown where plain:
      viewer.showPage(code == kVK_PageDown ? 1 : -1)
    case kVK_Space where plain:
      guard !controlFocused else { return false }
      guard !event.isARepeat else { return true }
      if mode == .text {
        viewer.setPanKey(true)
      } else {
        lightbox.close()
      }
    default:
      switch event.charactersIgnoringModifiers {
      case "+", "=": viewer.zoomIn()
      case "-", "−": viewer.zoomOut()
      case "0": viewer.toggleFit()
      default: return false
      }
    }
    return true
  }

  /// Space let go in text mode: a press draws a marquee again.
  func keyUp(_ event: NSEvent) -> Bool {
    guard Int(event.keyCode) == kVK_Space, viewer.panKeyHeld else { return false }
    viewer.setPanKey(false)
    return true
  }

  func flagsChanged(_ event: NSEvent) {
    setPeeking(event.modifierFlags.contains(.option))
  }

  func keyboardLost() {
    viewer.setPanKey(false)
    setPeeking(false)
  }

  /// ⌥ held (`on`) outside annotate mode, with replacements on the image: the canvas shows the
  /// original under them until it is let go.
  func setPeeking(_ on: Bool) {
    let next = on && !annotating && live && !fieldFocused
    guard next != peeking else { return }
    peeking = next
    annotator.peek(next, without: results.replacementIDs)
    if !next { results.landPending() }
  }

  func keyEquivalent(_ event: NSEvent) -> Bool {
    guard live else { return false }
    if IslandLightboxPanelState.toggles(event) {
      guard !event.isARepeat else { return true }
      togglePanel()
      return true
    }
    guard !annotator.isEditingText, !fieldFocused else { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    let character = event.charactersIgnoringModifiers?.lowercased() ?? ""
    if !annotating {
      switch (modifiers, character) {
      case (.command, "a"):
        text.selectAll()
        return true
      case (.command, "z"):
        return annotator.undoKey(redo: false)
      case ([.command, .shift], "z"):
        return annotator.undoKey(redo: true)
      default:
        break
      }
    }
    guard let key = IslandShellFooterKey(event, field: nil) else { return false }
    let showsCard = panelPlacement != .hidden
    switch key {
    case .copy:
      if showsCard, results.model.copyKey() { return true }
      if !annotating, !text.picks.isEmpty {
        copyText()
        return true
      }
    case .attach:
      if showsCard, results.model.primaryKey() { return true }
    }
    send(key)
    return true
  }

  /// Copy or Attach, on the range kept now with everything on it.
  func send(_ key: IslandShellFooterKey) {
    annotator.finish()
    switch key {
    case .copy: card.onEvent(.copy(card.state.kept))
    case .attach: card.onEvent(.attach(card.state.kept))
    }
  }

  /// Escape outside annotate mode, one step at a time; false with nothing left, so the lightbox
  /// closes.
  private func escape() -> Bool {
    if viewer.cancelMarquee() || menus.dismiss() || results.stopRunning() { return true }
    if panelPlacement.isDrawer {
      panel.hide()
      return true
    }
    if text.clear() { return true }
    guard mode == .text else { return false }
    setMode(.view)
    return true
  }

  /// The result card's field has the keyboard (a text view that is not the annotator's).
  var fieldFocused: Bool {
    guard let responder = annotator.canvas.window?.firstResponder as? NSText else { return false }
    return !annotator.isEditingText && !(responder as NSView).isDescendant(of: annotator.canvas)
  }
}
