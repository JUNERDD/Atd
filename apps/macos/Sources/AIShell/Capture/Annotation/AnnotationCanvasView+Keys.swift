import AICore
import AppKit

/// The canvas's keys (the contract on ``AnnotationCanvasView``): plain keys for the tools, the
/// selected annotation and the style bar's size, and the key equivalents taken ahead of the Edit
/// menu.
extension AnnotationCanvasView {
  override func keyDown(with event: NSEvent) {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return }
    interaction.disarmConfirmDoubleClick()
    if textEditor.isEditing, !textEditor.isHosted(in: self) {
      textEditor.type(event)
      return
    }
    if handleKey(event) { return }
    super.keyDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return true }
    let handled = keyEquivalent(event)
    if handled == true { interaction.disarmConfirmDoubleClick() }
    return handled ?? super.performKeyEquivalent(with: event)
  }

  /// ⌥ shows the originals of translated text while it is held; the host still hears it, for a
  /// drag reshaped with Shift.
  override func flagsChanged(with event: NSEvent) {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return }
    pointerOwner?.optionChanged(event.modifierFlags.contains(.option))
    super.flagsChanged(with: event)
  }

  func handleKey(_ event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard modifiers.isDisjoint(with: [.command, .control, .option]) else { return false }
    switch Int(event.keyCode) {
    case 53:  // Esc
      return onEscape?() ?? false
    case 48:  // Tab
      return !textEditor.isEditing && (onTab?(modifiers.contains(.shift)) ?? false)
    case 36, 76:  // Return, keypad Enter
      guard isActive || !store.selectedIDs.isEmpty else { return false }
      onConfirm?()
      return true
    case 51, 117:  // Delete, forward delete
      return !store.selectedIDs.isEmpty && interaction.deleteSelection()
    case 123, 124, 125, 126:  // ← → ↓ ↑
      guard !store.selectedIDs.isEmpty else { return false }
      let step: CGFloat = modifiers.contains(.shift) ? 10 : 1
      let offset: CGVector =
        switch Int(event.keyCode) {
        case 123: CGVector(dx: -step, dy: 0)
        case 124: CGVector(dx: step, dy: 0)
        case 125: CGVector(dx: 0, dy: step)
        default: CGVector(dx: 0, dy: -step)
        }
      return interaction.nudgeSelection(by: offset)
    default:
      let characters = event.charactersIgnoringModifiers ?? ""
      // `[` `]`, and PixPin's wheel keys `-` `=` (with Shift `_` `+`).
      if let step = ["[": -1, "-": -1, "_": -1, "]": 1, "=": 1, "+": 1][characters] {
        guard onStepStroke?(step) == true else { return false }
        if let text = onStepSizeHUD?() {
          showSizeHud(text)
        }
        return true
      }
      if characters.lowercased() == "i", let onToggleEyedropper {
        onToggleEyedropper()
        return true
      }
      if characters == "/" { return onAsk?() ?? false }
      guard let tool = AnnotationTool(key: characters) else { return false }
      onChooseTool?(tool)
      return true
    }
  }

  /// ⌘Z and ⇧⌘Z undo the document, or the typing while text is open; ⌘Delete clears all;
  /// ⌘C keeps screenshot / Live Text / result card copy, while ⇧⌘C copies selected annotations;
  /// ⌘D duplicates, ⌘V pastes, ⌘]/⌘[ reorder z-order, ⌘P pins, ⌘A picks Live Text paragraphs
  /// or all annotations, ⌘↩ is the result card's primary action, and ⌥⌘I toggles the card.
  func keyEquivalent(_ event: NSEvent) -> Bool? {
    if CaptureKeyEventFilter.isOwnSynthesizedKey(event) { return true }
    if let editor = window?.firstResponder as? NSTextView, editor.hasMarkedText() {
      return nil
    }
    if event.type == .keyDown, window?.isKeyWindow == true,
      IslandLightboxPanelState.toggles(event),
      (pointerOwner as? AnnotationEditor)?.toggleResultCard() == true
    {
      return true
    }
    // A field or selectable text view outside the canvas (the command row's ask field, the result
    // card's adjust field, or selected answer text in `ResultTextView`) keeps its editing/copy keys.
    if let editor = window?.firstResponder as? NSTextView,
      editor.isFieldEditor
        || (!editor.isDescendant(of: self) && editor.selectedRange().length > 0)
    {
      return nil
    }
    guard event.type == .keyDown, window?.isKeyWindow == true else { return nil }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    let key = event.charactersIgnoringModifiers?.lowercased()
    if !textEditor.isEditing,
      let handled = handleCommandShortcut(event: event, modifiers: modifiers, key: key)
    {
      return handled
    }
    if modifiers == .command, key == "s", let onSave {
      onSave()
      return true
    }
    if modifiers == .command, [36, 76].contains(Int(event.keyCode)), !textEditor.isEditing,
      onPrimary?() == true
    {
      return true
    }
    if modifiers == .command, event.keyCode == 51, onClearAll?() == true { return true }
    guard modifiers == .command || modifiers == [.command, .shift], key == "z" else { return nil }
    let redo = modifiers.contains(.shift)
    if textEditor.isEditing {
      let typing = textEditor.typingUndo
      if redo, typing.canRedo { typing.redo() } else if !redo, typing.canUndo { typing.undo() }
    } else if redo {
      store.redo()
    } else {
      store.undo()
    }
    return true
  }

  private func handleCommandShortcut(
    event: NSEvent, modifiers: NSEvent.ModifierFlags, key: String?
  ) -> Bool? {
    if modifiers == [.command, .shift], key == "c", !store.selectedIDs.isEmpty,
      interaction.copySelectedAnnotations()
    {
      showSizeHud(ShellStrings.shared.text(CaptureToolsStringKey.toastCopiedAnnotation))
      return true
    }
    guard modifiers == .command else { return nil }
    switch key {
    case "p":
      guard let onPin else { return nil }
      onPin()
      return true
    case "d":
      return interaction.duplicateSelection() ? true : nil
    case "]":
      return interaction.bringSelectionToFront() ? true : nil
    case "[":
      return interaction.sendSelectionToBack() ? true : nil
    case "c":
      if onCopy != nil, CaptureKeyEventFilter.isExternalSyntheticCopy(event) { return true }
      if onCopySelectionText?() == true { return true }
      if let onCopy {
        onCopy()
        return true
      }
      return nil
    case "v":
      return interaction.pasteCopiedAnnotations() ? true : nil
    case "a":
      if onSelectAll?() == true { return true }
      return interaction.selectAllAnnotations() ? true : nil
    default:
      return nil
    }
  }
}
