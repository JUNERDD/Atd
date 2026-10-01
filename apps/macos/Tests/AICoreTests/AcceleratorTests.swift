import Carbon.HIToolbox
import Testing

@testable import AICore

@Suite("Electron accelerator conversion")
struct AcceleratorTests {
  @Test("Modifier flags are Carbon's")
  func modifierFlags() {
    #expect(HotKeyModifiers.command.rawValue == UInt32(cmdKey))
    #expect(HotKeyModifiers.shift.rawValue == UInt32(shiftKey))
    #expect(HotKeyModifiers.option.rawValue == UInt32(optionKey))
    #expect(HotKeyModifiers.control.rawValue == UInt32(controlKey))
  }

  /// Every key of the grammar in `packages/agent-contracts/src/shortcuts.ts`, against the SDK's
  /// own `kVK_*` constants. F21–F24 are in the grammar but have no Mac key code.
  static let grammarKeys: [(String, Int)] =
    [
      ("A", kVK_ANSI_A), ("B", kVK_ANSI_B), ("C", kVK_ANSI_C), ("D", kVK_ANSI_D),
      ("E", kVK_ANSI_E), ("F", kVK_ANSI_F), ("G", kVK_ANSI_G), ("H", kVK_ANSI_H),
      ("I", kVK_ANSI_I), ("J", kVK_ANSI_J), ("K", kVK_ANSI_K), ("L", kVK_ANSI_L),
      ("M", kVK_ANSI_M), ("N", kVK_ANSI_N), ("O", kVK_ANSI_O), ("P", kVK_ANSI_P),
      ("Q", kVK_ANSI_Q), ("R", kVK_ANSI_R), ("S", kVK_ANSI_S), ("T", kVK_ANSI_T),
      ("U", kVK_ANSI_U), ("V", kVK_ANSI_V), ("W", kVK_ANSI_W), ("X", kVK_ANSI_X),
      ("Y", kVK_ANSI_Y), ("Z", kVK_ANSI_Z), ("0", kVK_ANSI_0), ("1", kVK_ANSI_1),
      ("2", kVK_ANSI_2), ("3", kVK_ANSI_3), ("4", kVK_ANSI_4), ("5", kVK_ANSI_5),
      ("6", kVK_ANSI_6), ("7", kVK_ANSI_7), ("8", kVK_ANSI_8), ("9", kVK_ANSI_9),
      (",", kVK_ANSI_Comma), (".", kVK_ANSI_Period), ("/", kVK_ANSI_Slash),
      (";", kVK_ANSI_Semicolon), ("'", kVK_ANSI_Quote), ("\\", kVK_ANSI_Backslash),
      ("[", kVK_ANSI_LeftBracket), ("]", kVK_ANSI_RightBracket), ("`", kVK_ANSI_Grave),
      ("-", kVK_ANSI_Minus), ("=", kVK_ANSI_Equal),
      ("Space", kVK_Space), ("Enter", kVK_Return), ("Tab", kVK_Tab), ("Backspace", kVK_Delete),
      ("Delete", kVK_ForwardDelete), ("Up", kVK_UpArrow), ("Down", kVK_DownArrow),
      ("Left", kVK_LeftArrow), ("Right", kVK_RightArrow), ("Home", kVK_Home), ("End", kVK_End),
      ("PageUp", kVK_PageUp), ("PageDown", kVK_PageDown),
      ("F1", kVK_F1), ("F2", kVK_F2), ("F3", kVK_F3), ("F4", kVK_F4), ("F5", kVK_F5),
      ("F6", kVK_F6), ("F7", kVK_F7), ("F8", kVK_F8), ("F9", kVK_F9), ("F10", kVK_F10),
      ("F11", kVK_F11), ("F12", kVK_F12), ("F13", kVK_F13), ("F14", kVK_F14), ("F15", kVK_F15),
      ("F16", kVK_F16), ("F17", kVK_F17), ("F18", kVK_F18), ("F19", kVK_F19), ("F20", kVK_F20),
    ]

  @Test("Maps every key of the grammar to its virtual key code", arguments: grammarKeys)
  func keyCodes(key: String, code: Int) throws {
    let combination = try Accelerator.parse("CommandOrControl+\(key)")
    #expect(combination == HotKeyCombination(keyCode: UInt32(code), modifiers: .command))
  }

  @Test("Covers the whole grammar")
  func coversGrammar() {
    // 26 letters, 10 digits, 11 symbols, 13 named keys, F1–F20.
    #expect(Self.grammarKeys.count == 26 + 10 + 11 + 13 + 20)
    #expect(Set(Self.grammarKeys.map(\.0)).count == Self.grammarKeys.count)
  }

  private static func combo(_ code: Int, _ modifiers: HotKeyModifiers) -> HotKeyCombination {
    HotKeyCombination(keyCode: UInt32(code), modifiers: modifiers)
  }

  @Test(
    "Maps modifiers the way macOS presses them, in any order",
    arguments: [
      ("CommandOrControl+Shift+Space", combo(kVK_Space, [.command, .shift])),
      ("Shift+CommandOrControl+Space", combo(kVK_Space, [.command, .shift])),
      ("CommandOrControl+N", combo(kVK_ANSI_N, .command)),
      ("CommandOrControl+,", combo(kVK_ANSI_Comma, .command)),
      ("Command+A", combo(kVK_ANSI_A, .command)),
      ("Super+A", combo(kVK_ANSI_A, .command)),
      ("Control+A", combo(kVK_ANSI_A, .control)),
      ("Alt+A", combo(kVK_ANSI_A, .option)),
      ("Alt+Shift+F5", combo(kVK_F5, [.option, .shift])),
      (
        "CommandOrControl+Control+Alt+Shift+Up",
        combo(kVK_UpArrow, [.command, .control, .option, .shift])
      ),
    ])
  func modifiers(accelerator: String, expected: HotKeyCombination) throws {
    #expect(try Accelerator.parse(accelerator) == expected)
  }

  @Test(
    "Refuses anything outside the grammar with a typed error",
    arguments: [
      ("", AcceleratorError.missingKey),
      ("CommandOrControl+", .missingKey),
      ("CommandOrControl++", .missingKey),
      ("CommandOrControl+a", .unknownKey("a")),
      ("CommandOrControl+Escape", .unknownKey("Escape")),
      ("CommandOrControl+Plus", .unknownKey("Plus")),
      ("CommandOrControl+F0", .unknownKey("F0")),
      ("CommandOrControl+F01", .unknownKey("F01")),
      ("CommandOrControl+F25", .unknownKey("F25")),
      ("CommandOrControl+Shift", .unknownKey("Shift")),
      ("CommandOrControl+AB", .unknownKey("AB")),
      ("CommandOrControl+F21", .unsupportedKey("F21")),
      ("CommandOrControl+F24", .unsupportedKey("F24")),
      ("Cmd+A", .unknownModifier("Cmd")),
      ("Option+A", .unknownModifier("Option")),
      ("commandorcontrol+A", .unknownModifier("commandorcontrol")),
      ("+A", .unknownModifier("")),
      ("CommandOrControl+Command+A", .duplicateModifier("Command")),
      ("Super+CommandOrControl+A", .duplicateModifier("CommandOrControl")),
      ("Shift+Shift+A", .duplicateModifier("Shift")),
      ("A", .missingModifier),
      ("Shift+A", .missingModifier),
      ("Space", .missingModifier),
    ])
  func refuses(accelerator: String, error: AcceleratorError) {
    #expect(throws: error) { try Accelerator.parse(accelerator) }
  }

  @Test("Refuses accelerators longer than 100 UTF-16 code units")
  func length() throws {
    let modifiers = String(repeating: "Shift+", count: 16)
    #expect(throws: AcceleratorError.tooLong) {
      try Accelerator.parse(modifiers + "CommandOrControl+A")
    }
    let emoji = "CommandOrControl+" + String(repeating: "😀", count: 42)
    #expect(emoji.count <= 100)
    #expect(throws: AcceleratorError.tooLong) { try Accelerator.parse(emoji) }
  }
}
