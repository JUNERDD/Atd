import Testing

@testable import AICore

@Suite("Selection copy fallback")
struct CopyFallbackTests {
  private func facts(
    _ focus: SelectionFocus, shellHasKeyboard: Bool = false, secureInput: Bool = false
  ) -> CopyFallbackFacts {
    CopyFallbackFacts(focus: focus, shellHasKeyboard: shellHasKeyboard, secureInput: secureInput)
  }

  @Test("The copy runs only where Accessibility could not tell whether anything is selected")
  func appliesToUnknownFocus() {
    #expect(CopyFallback.applies(facts(.unknown)))
    #expect(!CopyFallback.applies(facts(.emptyNativeText)))
    #expect(!CopyFallback.applies(facts(.secureField)))
    #expect(!CopyFallback.applies(facts(.unresponsive)))
  }

  @Test("Never into Atd itself or while secure input is on")
  func refusesShellAndSecureInput() {
    #expect(!CopyFallback.applies(facts(.unknown, shellHasKeyboard: true)))
    #expect(!CopyFallback.applies(facts(.unknown, secureInput: true)))
  }

  @Test("Shift, Control, Option and Command hold the copy back; Caps Lock and Fn do not")
  func heldModifiers() {
    let shift: UInt64 = 0x0002_0000
    let control: UInt64 = 0x0004_0000
    let option: UInt64 = 0x0008_0000
    let command: UInt64 = 0x0010_0000
    let capsLock: UInt64 = 0x0001_0000
    let function: UInt64 = 0x0080_0000
    let nonCoalesced: UInt64 = 0x0000_0100
    for flags in [shift, control, option, command, command | option | shift] {
      #expect(CopyFallback.shortcutModifiersHeld(flags))
    }
    for flags in [0, capsLock, function, nonCoalesced, capsLock | function] {
      #expect(!CopyFallback.shortcutModifiersHeld(flags))
    }
  }

  @Test("A copy counts as the selection only when it left text, and not the names of files")
  func copiedText() {
    #expect(CopyFallback.copiedText(string: "hello", hasFiles: false) == "hello")
    #expect(CopyFallback.copiedText(string: " a\n", hasFiles: false) == " a\n")
    #expect(CopyFallback.copiedText(string: nil, hasFiles: false) == nil)
    #expect(CopyFallback.copiedText(string: " \n\t", hasFiles: false) == nil)
    // Finder's copy of a file names it as a string too.
    #expect(CopyFallback.copiedText(string: "a.txt", hasFiles: true) == nil)
  }
}
