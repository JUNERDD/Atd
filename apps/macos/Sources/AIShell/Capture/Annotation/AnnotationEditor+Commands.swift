import AICore
import AppKit

/// The editor's side of the style bar's slot and what reads the selection's text (architecture
/// S1–S6): which bar shows in the slot, the launches from the command row, Copy text, and
/// auto-redact with the mosaic tool's badge. Both read ``recognizedText``, the session's reading
/// of the selection; text under a mosaic never leaves through Copy text.
extension AnnotationEditor {
  func dismissMenus() -> Bool { slot.dismiss() }

  /// Return while a tool is chosen, which the canvas takes then: an open menu closes first, as it
  /// does for Escape (``stepBack()``) and for Return without a tool (the session's `.confirm`), so
  /// the key means the same whichever tool is chosen.
  func confirmFromKey() {
    guard !dismissMenus() else { return }
    onConfirm?()
  }

  /// Wires the slot, auto-redact and undo's withdrawal of feedback; once, from `init`.
  func wireCommands() {
    slot.onLaunch = { [weak self] in self?.onLaunch?($0) }
    slot.onAskOpen = { [weak self] in self?.askOpening() }
    slot.onAskClose = { [weak self] in
      self?.refresh()
      self?.focusCanvas()
    }
    slot.onCopyText = { [weak self] in self?.copyText() }
    slot.onDrag = { [weak self] in self?.moveBars($0) }
    styleBar.onRedact = { [weak self] in self?.redactSensitive() }
    store.onUndoRedo = { [weak self] in self?.endFeedback() }
  }

  /// The second row for the current state, one at a time: the style bar while something is
  /// styled and the ask field is closed, else the field, the text row in text mode, or the
  /// command row; the badge and both auto-redact buttons follow what is still unmasked, and the
  /// text row's scope and running bar what text mode and the runs are doing.
  func refreshSlot() {
    text.mode.mask(mosaics)
    let target = slot.isAsking ? nil : styleTarget
    if let target {
      styleBar.update(style: target.style, controls: target.controls)
      styleBar.isHidden = false
    } else {
      styleBar.isHidden = true
    }
    let row: AnnotationCommandSlot.Shown = text.mode.isOn ? .text : .commands
    slot.show(target != nil ? nil : slot.isAsking ? .ask : row)
    let unmasked = unmaskedSensitive
    toolbar.setSensitiveCount(unmasked.count)
    styleBar.setRedaction(
      recognizedText.map { text in
        if !unmasked.isEmpty { return .cover(unmasked.count) }
        return text.sensitive.isEmpty ? .none : .allCovered
      } ?? .reading)
    slot.setRedaction(count: unmasked.count)
    slot.setSelectText(hasText: recognizedText.map { !$0.boxes.isEmpty })
    slot.setScope(scopeLabel)
    slot.setRunning(text.runs.running?.commandId)
  }

  /// A tool was chosen or dropped: menus, the field and feedback go.
  func toolChanged() {
    slot.toolChanged()
    styleBar.endRedactionFeedback()
  }

  /// Ends every in-place confirmation, and a Copy text still waiting for the text: they would
  /// describe a screen that changed.
  func endFeedback() {
    slot.copyPending = false
    slot.endFeedback()
    styleBar.endRedactionFeedback()
  }

  func recognizedTextChanged() {
    text.mode.read(recognizedText)
    if slot.copyPending, recognizedText != nil { copyText() }
    refresh()
  }

  // MARK: Ask

  /// The field takes the slot: the tool, the selected annotation and open text go; text mode
  /// and what it picked stay, for the question to read.
  private func askOpening() {
    textEditor.end()
    interaction.cancelGesture()
    store.selectedID = nil
    interaction.tool = nil
    updateClaim()
    styleBar.endRedactionFeedback()
    refreshPointer()
    refresh()
  }

  // MARK: Copy text

  /// Copies the selection's text in reading order, without what any mosaic covers, and says so on
  /// the button; while the text is still being read the copy waits for it.
  private func copyText() {
    guard let text = recognizedText else {
      slot.copyPending = true
      return
    }
    slot.copyPending = false
    let strings = ShellStrings.shared
    let lines = ScreenContext.readingOrder(ScreenContext.unredacted(text.boxes, hiding: mosaics))
    guard !lines.isEmpty else {
      let said = strings.text(.captureCommandsNoTextDetail)
      slot.confirmCopy(.noText, tooltip: said)
      Self.announce(said)
      return
    }
    guard slot.setup?.copyText(lines.joined(separator: "\n")) == true else { return }
    let said = strings.text(.captureCommandsCopiedLines, count: lines.count)
    slot.confirmCopy(.copied, tooltip: said)
    Self.announce(said)
  }

  // MARK: Auto-redact

  /// The mosaics' rects (desktop points).
  var mosaics: [CGRect] {
    store.document.annotations.compactMap { annotation in
      if case .mosaic(let rect) = annotation.shape { rect } else { nil }
    }
  }

  /// The sensitive items no mosaic covers yet.
  private var unmaskedSensitive: [SensitiveText.Box] {
    guard let text = recognizedText else { return [] }
    return SensitiveText.uncovered(text.sensitive, by: mosaics)
  }

  /// Covers every unmasked sensitive item with a mosaic in the style auto-redact shows, a few
  /// points past it, as one undo step, then says so on the button that asked: the mosaic style
  /// bar's or its shortcut on the command row (decision D7).
  func redactSensitive() {
    let hits = unmaskedSensitive
    guard !hits.isEmpty else { return }
    textEditor.end()
    let style = styleTarget?.style ?? interaction.styles[AnnotationTool.mosaic.styleSlot]
    store.commit(store.document.redacting(hits, style: style))
    let strings = ShellStrings.shared
    let said =
      strings.text(.captureRedactDone, count: hits.count) + " · "
      + strings.text(.captureRedactUndoHint)
    styleBar.confirmRedaction(count: hits.count, tooltip: said)
    slot.confirmRedaction(count: hits.count, tooltip: said)
    Self.announce(said)
  }
}
