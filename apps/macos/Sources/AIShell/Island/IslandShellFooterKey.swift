import AppKit
import Carbon.HIToolbox

/// The shell cards' footer shortcuts (the recording's, the long screenshot's), as the command
/// result cards' are: ⌘C copies what the card keeps, unless text in the ask field is selected
/// (the field copies it then, the usual way), and ⌘↩ performs the primary action, attaching to
/// the conversation, from the ask field too. They arrive as key equivalents, ahead of the field
/// and the menus (``IslandWindow/onKeyEquivalent``); none is read while the field composes
/// marked text. Their buttons show the same keys (``copyKeys``, ``attachKeys``).
enum IslandShellFooterKey {
  case save, copy, attach

  static let copyKeys = "⌘C"
  static let attachKeys = "⌘↩"

  /// The shortcut `event` presses while `field` is the ask field being edited, if any.
  init?(_ event: NSEvent, field: NSTextView?) {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard event.type == .keyDown, modifiers == .command, field?.hasMarkedText() != true
    else { return nil }
    let character = event.charactersIgnoringModifiers?.lowercased()
    if [kVK_Return, kVK_ANSI_KeypadEnter].contains(Int(event.keyCode)) {
      self = .attach
    } else if character == "s" {
      self = .save
    } else if character == "c", (field?.selectedRange().length ?? 0) == 0 {
      // By character, so ⌘C is found on any keyboard layout.
      self = .copy
    } else {
      return nil
    }
  }
}
