import Foundation

/// The `key` step as the driver and the app's menus name it: the driver's chord string, and
/// whether a menu item's shortcut is that chord, so the host can press the item through
/// accessibility instead of posting keys (a background command chord never reaches the menus).
public enum NativeKeyChord {
  /// A menu item's shortcut as accessibility reports it (`AXMenuItemCmdChar`,
  /// `AXMenuItemCmdVirtualKey`, `AXMenuItemCmdModifiers`).
  public struct MenuShortcut: Equatable, Sendable {
    public let character: String?
    public let virtualKey: Int?
    /// The modifier mask: 1 shift, 2 option, 4 control, 8 no command key (0 is ⌘ alone).
    public let modifiers: Int

    public init(character: String?, virtualKey: Int?, modifiers: Int) {
      self.character = character
      self.virtualKey = virtualKey
      self.modifiers = modifiers
    }
  }

  /// The driver's chord for `key` with `modifiers` (`cmd+shift+a`).
  public static func chord(_ key: ComputerKeyName, modifiers: [ComputerModifier]) -> String {
    let ordered: [ComputerModifier] = [.cmd, .ctrl, .option, .shift]
    return (ordered.filter(modifiers.contains).map(\.rawValue) + [key.rawValue])
      .joined(separator: "+")
  }

  /// Whether `shortcut` is `key` with exactly `modifiers`.
  public static func matches(
    _ shortcut: MenuShortcut, key: ComputerKeyName, modifiers: [ComputerModifier]
  ) -> Bool {
    let mask = shortcut.modifiers
    guard (mask & 8 == 0) == modifiers.contains(.cmd),
      (mask & 1 != 0) == modifiers.contains(.shift),
      (mask & 2 != 0) == modifiers.contains(.option),
      (mask & 4 != 0) == modifiers.contains(.ctrl)
    else { return false }
    if let code = shortcut.virtualKey, code != 0, let own = virtualKeys[key], code == own {
      return true
    }
    guard let character = shortcut.character?.lowercased(), !character.isEmpty else {
      return false
    }
    return characters(of: key).contains(character)
  }

  /// The key-equivalent characters AppKit uses for `key`: the letter or digit itself, or the
  /// control and function-key characters of the named keys.
  private static func characters(of key: ComputerKeyName) -> Set<String> {
    if key.isCharacter { return [key.rawValue] }
    let scalars: [UInt32] =
      switch key {
      case .return: [0x0D, 0x03]
      case .tab: [0x09]
      case .space: [0x20]
      case .delete: [0x08, 0x7F]
      case .escape: [0x1B]
      case .up: [0xF700]
      case .down: [0xF701]
      case .left: [0xF702]
      case .right: [0xF703]
      case .home: [0xF729]
      case .end: [0xF72B]
      case .pageup: [0xF72C]
      case .pagedown: [0xF72D]
      default: functionKeys[key].map { [$0] } ?? []
      }
    return Set(scalars.compactMap(Unicode.Scalar.init).map { String(Character($0)) })
  }

  private static let functionKeys: [ComputerKeyName: UInt32] = [
    .f1: 0xF704, .f2: 0xF705, .f3: 0xF706, .f4: 0xF707, .f5: 0xF708, .f6: 0xF709,
    .f7: 0xF70A, .f8: 0xF70B, .f9: 0xF70C, .f10: 0xF70D, .f11: 0xF70E, .f12: 0xF70F,
  ]

  /// Carbon virtual key codes of the keys that have no character (`kVK_*`).
  private static let virtualKeys: [ComputerKeyName: Int] = [
    .return: 0x24, .tab: 0x30, .space: 0x31, .delete: 0x33, .escape: 0x35, .left: 0x7B,
    .right: 0x7C, .down: 0x7D, .up: 0x7E, .home: 0x73, .end: 0x77, .pageup: 0x74,
    .pagedown: 0x79, .f1: 0x7A, .f2: 0x78, .f3: 0x63, .f4: 0x76, .f5: 0x60, .f6: 0x61,
    .f7: 0x62, .f8: 0x64, .f9: 0x65, .f10: 0x6D, .f11: 0x67, .f12: 0x6F,
  ]
}
