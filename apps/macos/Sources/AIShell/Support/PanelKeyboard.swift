import AppKit

enum PanelKeyboard {
  fileprivate(set) static var isReturningToFrontmostApp = false

  static var anotherAppOwnsMenuBar: Bool {
    if let frontmost = NSWorkspace.shared.frontmostApplication {
      return frontmost != NSRunningApplication.current
    }
    return !NSApp.isActive
  }

  fileprivate static func performOrderOut(returningToOtherApp: Bool, _ body: () -> Void) {
    let previous = isReturningToFrontmostApp
    isReturningToFrontmostApp = previous || returningToOtherApp
    defer { isReturningToFrontmostApp = previous }
    body()
    if returningToOtherApp { NSApp.deactivate() }
  }
}

extension NSPanel {
  /// Gives back the keyboard a non-activating panel took. Such a panel must be ordered out to
  /// release its keyboard grab. AppKit can then make another ordered Atd window key, even a task
  /// panel behind the source app. When another app still owns the menu bar, suppress resident
  /// Atd panels from taking key while ordering out and deactivate Atd so that app regains the
  /// keyboard; ordering the panel back in within the same run-loop turn keeps it visible without
  /// taking the keyboard.
  func returnKeyboard() {
    guard isKeyWindow, isVisible else { return }
    PanelKeyboard.performOrderOut(returningToOtherApp: PanelKeyboard.anotherAppOwnsMenuBar) {
      orderOut(nil)
      orderFrontRegardless()
    }
  }

  /// Orders a non-activating panel out and, when it held the keyboard while another app owned
  /// the menu bar, returns keyboard focus to that app without waking resident Atd panels.
  func orderOutReturningKeyboard() {
    PanelKeyboard.performOrderOut(
      returningToOtherApp: isKeyWindow && PanelKeyboard.anotherAppOwnsMenuBar
    ) {
      orderOut(nil)
    }
  }

  /// Takes the keyboard for a control the person clicked that needs it, as a click in a text
  /// field would (`becomesKeyOnlyIfNeeded`). A non-activating panel becomes key without
  /// activating Atd; ``returnKeyboard()`` gives it back.
  func takeKeyboard() {
    guard canBecomeKey, isVisible, !isKeyWindow else { return }
    makeKey()
  }
}
