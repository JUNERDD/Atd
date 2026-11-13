import AICore
import AppKit
import Carbon.HIToolbox

/// How a key press reads in a recording: the badge it shows and what the input log records.
struct RecordingKeyPress: Equatable {
  /// What a key badge shows: the held modifiers and the key cap.
  let modifiers: RecordingModifiers
  let key: RecordingKey
  /// The characters typed when the press types (no ⌘ or ⌃ held, a key that types); nil for a
  /// shortcut or a key that does not type.
  let text: String?

  /// The input log's event for the press.
  var kind: RecordingInputEvent.Kind {
    text.map { .text($0) } ?? .keys(modifiers, key)
  }

  /// The press `event` (a key down) made; nil for a key the recording does not show, such as
  /// a modifier alone or a dead key that typed nothing yet.
  init?(_ event: NSEvent) {
    var modifiers: RecordingModifiers = []
    let flags = event.modifierFlags
    if flags.contains(.control) { modifiers.insert(.control) }
    if flags.contains(.option) { modifiers.insert(.option) }
    if flags.contains(.shift) { modifiers.insert(.shift) }
    if flags.contains(.command) { modifiers.insert(.command) }
    self.modifiers = modifiers
    if let special = Self.special[Int(event.keyCode)] {
      key = special
      text = special == .space && !modifiers.makesShortcut ? " " : nil
      return
    }
    guard let cap = event.charactersIgnoringModifiers, let first = cap.first,
      !first.isNewline,
      first.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else { return nil }
    key = .character(cap.uppercased())
    if modifiers.makesShortcut {
      text = nil
    } else {
      guard let typed = event.characters, !typed.isEmpty else { return nil }
      text = typed
    }
  }

  /// Keys that do not type, by virtual key code (`kVK_*`), and Space, whose badge is a word.
  private static let special: [Int: RecordingKey] = {
    var keys: [Int: RecordingKey] = [
      kVK_Space: .space, kVK_Return: .returnKey, kVK_ANSI_KeypadEnter: .returnKey, kVK_Tab: .tab,
      kVK_Delete: .delete, kVK_ForwardDelete: .forwardDelete, kVK_Escape: .escape,
      kVK_LeftArrow: .left, kVK_RightArrow: .right, kVK_UpArrow: .up, kVK_DownArrow: .down,
      kVK_Home: .home, kVK_End: .end, kVK_PageUp: .pageUp, kVK_PageDown: .pageDown,
    ]
    let functions = [
      kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10, kVK_F11,
      kVK_F12, kVK_F13, kVK_F14, kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19, kVK_F20,
    ]
    for (index, code) in functions.enumerated() { keys[code] = .function(index + 1) }
    return keys
  }()
}
