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

  /// The second row for the current state: the style bar while something is styled and the
  /// ask field is closed, else the command row or the field; the badge and auto-redact follow
  /// what is still unmasked.
  func refreshSlot() {
    let target = slot.isAsking ? nil : styleTarget
    if let target {
      styleBar.update(style: target.style, controls: target.controls)
      styleBar.isHidden = false
    } else {
      styleBar.isHidden = true
    }
    slot.show(target != nil ? nil : slot.isAsking ? .ask : .commands)
    let unmasked = unmaskedSensitive
    toolbar.setSensitiveCount(unmasked.count)
    styleBar.setRedaction(
      recognizedText.map { text in
        if !unmasked.isEmpty { return .cover(unmasked.count) }
        return text.sensitive.isEmpty ? .none : .allCovered
      } ?? .reading)
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
    if slot.copyPending, recognizedText != nil { copyText() }
    refresh()
  }

  // MARK: Ask

  /// The field takes the slot: the tool, the selected annotation and open text go.
  private func askOpening() {
    textEditor.end()
    interaction.cancelGesture()
    store.selectedID = nil
    if interaction.tool != nil {
      interaction.tool = nil
      onInteriorClaimChange?(false)
    }
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
  private var mosaics: [CGRect] {
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
  /// points past it, as one undo step, then says so on the button.
  private func redactSensitive() {
    let hits = unmaskedSensitive
    guard !hits.isEmpty else { return }
    textEditor.end()
    let style = styleTarget?.style ?? interaction.styles[AnnotationTool.mosaic.styleSlot]
    var next = store.document
    for hit in hits {
      next.add(Annotation(shape: .mosaic(hit.box.insetBy(dx: -3, dy: -3).integral), style: style))
    }
    store.commit(next)
    let strings = ShellStrings.shared
    let said =
      strings.text(.captureRedactDone, count: hits.count) + " · "
      + strings.text(.captureRedactUndoHint)
    styleBar.confirmRedaction(count: hits.count, tooltip: said)
    Self.announce(said)
  }

  /// Says `text` to VoiceOver without showing anything more.
  private static func announce(_ text: String) {
    NSAccessibility.post(
      element: NSApplication.shared, notification: .announcementRequested,
      userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
  }
}
