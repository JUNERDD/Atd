import AppKit

extension NSPanel {
  /// Gives back the keyboard a non-activating panel took. Such a panel must be ordered out to
  /// release its keyboard grab. AppKit can then make another ordered Atd window key, even a task
  /// panel behind the source app. When another app still owns the menu bar, deactivate Atd too
  /// so that app regains the keyboard; activating an already-frontmost app alone leaves the grab
  /// with Atd. Ordering the panel back in within the same run-loop turn keeps it visible without
  /// taking the keyboard.
  func returnKeyboard() {
    guard isKeyWindow, isVisible else { return }
    orderOut(nil)
    orderFrontRegardless()
    if let frontmost = NSWorkspace.shared.frontmostApplication,
      frontmost != NSRunningApplication.current
    {
      NSApp.deactivate()
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
