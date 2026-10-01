/// Carbon modifier flags for `RegisterEventHotKey` (`cmdKey`, `shiftKey`, `optionKey`,
/// `controlKey` in HIToolbox/Events.h).
public struct HotKeyModifiers: OptionSet, Hashable, Sendable {
  public let rawValue: UInt32
  public init(rawValue: UInt32) { self.rawValue = rawValue }

  public static let command = HotKeyModifiers(rawValue: 0x0100)
  public static let shift = HotKeyModifiers(rawValue: 0x0200)
  public static let option = HotKeyModifiers(rawValue: 0x0800)
  public static let control = HotKeyModifiers(rawValue: 0x1000)
}

/// A global hot key as Carbon registers it: a virtual key code (`kVK_*`) and modifiers.
public struct HotKeyCombination: Hashable, Sendable {
  public let keyCode: UInt32
  public let modifiers: HotKeyModifiers
}

public enum AcceleratorError: Error, Equatable, Sendable {
  /// Longer than the contract's 100 UTF-16 code units (JavaScript `length`).
  case tooLong
  /// Nothing after the last `+`.
  case missingKey
  /// A key outside the accelerator grammar (for example lower-case `a` or `Escape`).
  case unknownKey(String)
  /// A key of the grammar that no Mac keyboard has (F21–F24).
  case unsupportedKey(String)
  case unknownModifier(String)
  /// Two modifiers that press the same key on macOS (`CommandOrControl+Command`).
  case duplicateModifier(String)
  /// A global shortcut needs a modifier other than Shift.
  case missingModifier
}

/// Converts the Electron accelerator strings the app stores (`parseAccelerator` in
/// `packages/agent-contracts/src/shortcuts.ts`, validated with `requireModifier` and
/// `platform: 'darwin'`, as every global registration is) into Carbon hot keys. The vocabulary
/// is exactly that grammar; anything else is a typed error, never a guess.
public enum Accelerator {
  public static let maxLength = 100

  public static func parse(_ accelerator: String) throws(AcceleratorError) -> HotKeyCombination {
    guard accelerator.utf16.count <= maxLength else { throw .tooLong }
    var parts = accelerator.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
    let key = parts.removeLast()
    guard !key.isEmpty else { throw .missingKey }
    let keyCode = try keyCode(for: key)
    var modifiers: HotKeyModifiers = []
    for part in parts {
      guard let modifier = modifierNames[part] else { throw .unknownModifier(part) }
      guard !modifiers.contains(modifier) else { throw .duplicateModifier(part) }
      modifiers.insert(modifier)
    }
    guard !modifiers.subtracting(.shift).isEmpty else { throw .missingModifier }
    return HotKeyCombination(keyCode: keyCode, modifiers: modifiers)
  }

  /// `CommandOrControl` and `Super` press Command on macOS.
  private static let modifierNames: [String: HotKeyModifiers] = [
    "CommandOrControl": .command, "Command": .command, "Super": .command, "Control": .control,
    "Alt": .option, "Shift": .shift,
  ]

  private static func keyCode(for key: String) throws(AcceleratorError) -> UInt32 {
    if let code = keyCodes[key] { return code }
    if let number = functionKeyNumber(key), (21...24).contains(number) {
      throw .unsupportedKey(key)
    }
    throw .unknownKey(key)
  }

  /// `F1`–`F24` without leading zeros, as the grammar spells them.
  private static func functionKeyNumber(_ key: String) -> Int? {
    guard key.first == "F", let number = Int(key.dropFirst()), (1...24).contains(number),
      "F\(number)" == key
    else { return nil }
    return number
  }

  /// `kVK_*` virtual key codes (HIToolbox/Events.h), ANSI positions for letters, digits and
  /// symbols; the recorder stores physical keys, so positions are what the user pressed.
  private static let keyCodes: [String: UInt32] = [
    "A": 0x00, "S": 0x01, "D": 0x02, "F": 0x03, "H": 0x04, "G": 0x05, "Z": 0x06, "X": 0x07,
    "C": 0x08, "V": 0x09, "B": 0x0B, "Q": 0x0C, "W": 0x0D, "E": 0x0E, "R": 0x0F, "Y": 0x10,
    "T": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18,
    "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E, "O": 0x1F, "U": 0x20,
    "[": 0x21, "I": 0x22, "P": 0x23, "L": 0x25, "J": 0x26, "'": 0x27, "K": 0x28, ";": 0x29,
    "\\": 0x2A, ",": 0x2B, "/": 0x2C, "N": 0x2D, "M": 0x2E, ".": 0x2F, "`": 0x32,
    "Enter": 0x24, "Tab": 0x30, "Space": 0x31, "Backspace": 0x33, "Delete": 0x75,
    "Home": 0x73, "End": 0x77, "PageUp": 0x74, "PageDown": 0x79,
    "Left": 0x7B, "Right": 0x7C, "Down": 0x7D, "Up": 0x7E,
    "F1": 0x7A, "F2": 0x78, "F3": 0x63, "F4": 0x76, "F5": 0x60, "F6": 0x61, "F7": 0x62,
    "F8": 0x64, "F9": 0x65, "F10": 0x6D, "F11": 0x67, "F12": 0x6F, "F13": 0x69, "F14": 0x6B,
    "F15": 0x71, "F16": 0x6A, "F17": 0x40, "F18": 0x4F, "F19": 0x50, "F20": 0x5A,
  ]
}
