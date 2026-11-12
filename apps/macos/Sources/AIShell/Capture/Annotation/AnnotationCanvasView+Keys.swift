import AICore
import AppKit

/// The canvas's keys (the contract on ``AnnotationCanvasView``): plain keys for the tools, the
/// selected annotation and the style bar's size, and the key equivalents taken ahead of the Edit
/// menu.
extension AnnotationCanvasView {
  func handleKey(_ event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard modifiers.isDisjoint(with: [.command, .control, .option]) else { return false }
    switch Int(event.keyCode) {
    case 53:  // Esc
      return onEscape?() ?? false
    case 36, 76:  // Return, keypad Enter
      guard isActive else { return false }
      onConfirm?()
      return true
    case 51, 117:  // Delete, forward delete
      return isActive && interaction.deleteSelection()
    case 123, 124, 125, 126:  // ← → ↓ ↑
      guard isActive else { return false }
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
        return onStepStroke?(step) ?? false
      }
      if characters == "/" { return onAsk?() ?? false }
      guard let tool = AnnotationTool(key: characters) else { return false }
      onChooseTool?(tool)
      return true
    }
  }

  /// ⌘Z and ⇧⌘Z undo the document, or the typing while text is open; ⌘Delete clears it; ⌘C
  /// copies (``onCopy`` decides what), except while text is open, where it copies the text
  /// selected in it; ⌘A picks every paragraph in text mode; ⌘↩ is the result card's primary
  /// action; ⌥⌘I shows or hides the result card once a run started. They are taken here rather
  /// than through the Edit menu, whose `undo:` would reach the window's undo manager, and ahead
  /// of an open text view's own handling of the keys. Nil leaves the event to the rest of the
  /// window.
  func keyEquivalent(_ event: NSEvent) -> Bool? {
    if let editor = window?.firstResponder as? NSTextView, editor.hasMarkedText() {
      return nil
    }
    if event.type == .keyDown, window?.isKeyWindow == true,
      IslandLightboxPanelState.toggles(event),
      (pointerOwner as? AnnotationEditor)?.toggleResultCard() == true
    {
      return true
    }
    // A field outside the canvas (the command row's ask field, the result card's adjust field)
    // keeps its editing keys: its bar or card takes them.
    if let editor = window?.firstResponder as? NSTextView, editor.isFieldEditor {
      return nil
    }
    guard event.type == .keyDown, window?.isKeyWindow == true else { return nil }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    let key = event.charactersIgnoringModifiers?.lowercased()
    if modifiers == .command, key == "c", !textEditor.isEditing, let onCopy {
      onCopy()
      return true
    }
    if modifiers == .command, key == "a", !textEditor.isEditing, onSelectAll?() == true {
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
}
