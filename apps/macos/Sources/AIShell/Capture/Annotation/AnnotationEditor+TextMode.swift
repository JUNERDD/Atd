import AICore
import AppKit

/// Text mode (the plan's 「选取文字」) as the editor runs it: entered from the screenshot row's
/// Select Text, it claims the selection's interior from the session (a double-click there no
/// longer confirms) and shows the text row in the slot; Escape steps out of it one level at a
/// time; ⌘A picks every paragraph and ⌘C copies what is selected. What is picked travels with a
/// command or a question launched from the capture (``pickedText``).
extension AnnotationEditor {
  /// Wires the slot's text parts, the result card, and the runs' versions following undo and
  /// redo; once, from `init`.
  func wireText() {
    slot.onSelectText = { [weak self] in self?.enterTextMode() }
    slot.onRedact = { [weak self] in self?.redactSensitive() }
    slot.onRedactionFeedbackEnd = { [weak self] in self?.refresh() }
    slot.isTextMode = { [weak self] in self?.text.mode.isOn ?? false }
    slot.onTextRun = { [weak self] in self?.runText($0) }
    slot.onTextAsk = { [weak self] question, output in self?.runTextAsk(question, output: output) }
    slot.onTextCopy = { [weak self] in self?.copySelectedText(fromKey: false) }
    slot.onScopeClear = { [weak self] in self?.clearScope() }
    slot.onToggleResults = { [weak self] in self?.toggleResultCard() }
    text.card.onAction = { [weak self] in self?.cardAction($0) }
    store.onRestored = { [weak self] in self?.followUndo() }
  }

  var pickedText: String? { text.mode.launchSelection }

  func enterTextMode() {
    guard !text.mode.isOn else { return }
    textEditor.end()
    interaction.cancelGesture()
    store.selectedID = nil
    toolChanged()
    interaction.tool = nil
    text.mode.read(recognizedText)
    text.mode.mask(mosaics)
    text.mode.set(on: true)
    updateClaim()
    refreshPointer()
    refresh()
    flashText(text.mode.available.map { text.mode.layout[$0].box })
    Self.announce(ShellStrings.shared.text(CaptureTextModeStringKey.entered))
  }

  func exitTextMode() {
    guard text.mode.isOn else { return }
    text.mode.set(on: false)
    updateClaim()
    refreshPointer()
    refresh()
  }

  /// The scope chip's ×: the selection goes, and with nothing selected text mode ends.
  func clearScope() {
    if !text.mode.clearSelection() { exitTextMode() }
    refresh()
  }

  /// Esc steps back one level (E6): an open menu or the ask field closes, else a running text
  /// command stops, else open text ends, else a gesture in progress (a stroke, a marquee, a
  /// character drag) is dropped, else the result card closes (a review discards), else the
  /// selected annotation is deselected, else text mode's selection goes, else text mode ends,
  /// else the tool is dropped. False when none applied, so the key goes on to the session, which
  /// cancels.
  func stepBack() -> Bool {
    if slot.dismiss() { return true }
    if let running = text.runs.running {
      slot.setup?.textRuns?.act(.stop, runId: running.id)
      return true
    }
    if textEditor.isEditing {
      textEditor.end()
    } else if interaction.isGesturing {
      interaction.cancelGesture()
    } else if text.mode.cancelGesture() {
      // The marquee or the drag went; the picks are as they were.
    } else if text.card.escape() {
      // The card closed or discarded.
    } else if store.selectedID != nil {
      store.selectedID = nil
    } else if text.mode.isOn {
      if !text.mode.clearSelection() { exitTextMode() }
    } else if interaction.tool != nil {
      choose(nil)
    } else {
      return false
    }
    refreshPointer()
    refresh()
    return true
  }

  /// A press inside an interior nobody claimed that is still the editor's: a step badge a text
  /// command drew opens its result card.
  func claimsPress(at point: CGPoint) -> Bool {
    interaction.tool == nil && !text.mode.isOn && stepBadge(at: point) != nil
  }

  /// ⌘C: the selected characters or the picked paragraphs, else the result card's answer, else
  /// the screenshot itself (the session ends with it).
  func copyFromKey() {
    if text.mode.selection != nil {
      copySelectedText(fromKey: true)
    } else if !text.card.copyKey() {
      onCopy?()
    }
  }

  /// ⌘A in text mode picks every paragraph; false otherwise, so the session's Select All widens
  /// the selection to the display.
  func selectAllFromKey() -> Bool {
    guard text.mode.isOn else { return false }
    text.mode.selectAll()
    refresh()
    return true
  }

  /// Copies what text mode selects (``CaptureTextMode/selection``; with the text row's Copy and
  /// nothing selected, every paragraph a mosaic leaves), without what any mosaic touches, and
  /// says so on Copy.
  func copySelectedText(fromKey: Bool) {
    let mode = text.mode
    let strings = ShellStrings.shared
    guard let copied = fromKey ? mode.selection : mode.copyText else {
      let said = strings.text(.captureCommandsNoTextDetail)
      slot.confirmCopy(.noText, tooltip: said, text: true)
      Self.announce(said)
      return
    }
    guard slot.setup?.copyText(copied) == true else { return }
    let said =
      mode.selectedCharacters != nil
      ? strings.text(CaptureTextModeStringKey.copiedCharacters)
      : text.card.labels.copiedText(mode.reading.count)
    slot.confirmCopy(.copied, tooltip: said, text: true)
    Self.announce(said)
  }

  /// The text row's scope chip: what a command reads now.
  var scopeLabel: String {
    if let count = text.mode.selectedCount {
      return ShellStrings.shared.text(CaptureTextModeStringKey.scopeCharacters, count: count)
    }
    return text.card.labels.scope(text.mode.scope)
  }

  // MARK: The washes

  /// Every canvas's text layer for the current state: text mode's chips, selection and marquee,
  /// the paragraphs a running command reads, and the paragraph of the item hovered on the card.
  func refreshTextLayers() {
    let mode = text.mode
    var scene = CaptureTextLayerView.Scene()
    if mode.isOn {
      let picked = mode.selectedCharacters == nil ? mode.picks.picked : []
      scene.chips = mode.available.map { index in
        CaptureTextLayerView.Chip(
          box: mode.layout[index].box, hovered: mode.hovered == index,
          picked: picked.contains(index))
      }
      scene.characters =
        mode.selectedCharacters?.rects(
          in: mode.layout, glyphs: mode.glyphs, available: mode.availableSet) ?? []
      if case .marquee(_, let rect) = mode.gesture { scene.marquee = rect }
    }
    if let running = text.runs.running, !running.remaking {
      // Paragraphs shimmer until a piece of the answer is about them (landed or previewed); while
      // another version is made the one shown stays, without a shimmer.
      let answered = Set(running.items.map(\.paragraph))
      scene.reading = running.paragraphs.filter { !answered.contains($0.id) }.map(\.paragraph.box)
    }
    if text.card.presentation == .card, let item = text.card.hotItem,
      let box = paragraphBox(of: item, in: text.card.card?.run)
    {
      scene.hot = [box]
    }
    for canvas in canvases { canvas.textLayer.scene = scene }
  }

  /// Flashes `boxes` (paragraph boxes) once on every canvas.
  func flashText(_ boxes: [CGRect]) {
    for canvas in canvases { canvas.textLayer.flash(boxes) }
  }

  /// The box of the paragraph item `item` of run `runID` is about.
  func paragraphBox(of item: Int, in runID: String?) -> CGRect? {
    guard let runID, let run = text.runs[runID], run.items.indices.contains(item) else {
      return nil
    }
    return run[paragraph: run.items[item].paragraph]?.box
  }

  /// Says `text` to VoiceOver without showing anything more.
  static func announce(_ text: String) {
    NSAccessibility.post(
      element: NSApplication.shared, notification: .announcementRequested,
      userInfo: [.announcement: text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
  }
}
