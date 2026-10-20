import Foundation

/// A `key` step as the browser worker presses it: a Playwright key chord such as `Enter`,
/// `Meta+Shift+z` or `Control+PageDown` (modifiers first, in a fixed order, joined by `+`). The
/// closed key set maps one to one; `delete` is the key labelled delete on a Mac keyboard, which
/// erases backwards (`Backspace`).
public enum BrowserKeyChord {
  public static func chord(_ key: ComputerKeyName, modifiers: [ComputerModifier]) -> String {
    let order: [ComputerModifier] = [.ctrl, .option, .shift, .cmd]
    return (order.filter(modifiers.contains).map(name) + [name(key)]).joined(separator: "+")
  }

  static func name(_ modifier: ComputerModifier) -> String {
    switch modifier {
    case .ctrl: "Control"
    case .option: "Alt"
    case .shift: "Shift"
    case .cmd: "Meta"
    }
  }

  static func name(_ key: ComputerKeyName) -> String {
    switch key {
    case .return: "Enter"
    case .tab: "Tab"
    case .escape: "Escape"
    case .up: "ArrowUp"
    case .down: "ArrowDown"
    case .left: "ArrowLeft"
    case .right: "ArrowRight"
    case .space: "Space"
    case .delete: "Backspace"
    case .home: "Home"
    case .end: "End"
    case .pageup: "PageUp"
    case .pagedown: "PageDown"
    // Letters and digits are their own key; f1…f12 are F1…F12.
    default: key.isCharacter ? key.rawValue : key.rawValue.uppercased()
    }
  }
}
