import AppKit

enum PanelKeyboard {
  fileprivate(set) static var isReturningToFrontmostApp = false

  static var anotherAppOwnsMenuBar: Bool {
    if let frontmost = NSWorkspace.shared.frontmostApplication {
      return frontmost != NSRunningApplication.current
    }
    return !NSApp.isActive
  }

  static func performOrderOut(
    suppressingResidentKey: Bool, deactivating: Bool, _ body: () -> Void
  ) {
    let previous = isReturningToFrontmostApp
    isReturningToFrontmostApp = previous || suppressingResidentKey
    defer { isReturningToFrontmostApp = previous }
    body()
    if deactivating { stepAside() }
  }

  /// Returns keyboard focus to another app: releases local key grabs when another app already
  /// owns the menu bar, or cooperatively yields activation to the topmost visible regular app when
  /// Atd itself is foreground-active.
  static func stepAside() {
    if anotherAppOwnsMenuBar {
      NSApp.deactivate()
      return
    }
    guard NSApp.isActive else { return }
    NSApp.deactivate()
    if let target = WindowStack.topmostOtherApplication() {
      _ = target.activate(from: .current, options: [])
    }
  }

  /// Hands keyboard focus to an eligible uncovered window of Atd, or steps aside when none
  /// exists.
  static func handOff(excluding closingWindow: NSWindow?) {
    if let successor = AppPresence.focusTarget(excluding: closingWindow) {
      if !NSApp.isActive { NSApp.activate() }
      successor.makeKeyAndOrderFront(nil)
    } else {
      stepAside()
    }
  }

  /// Runs `body` while suppressing resident Atd key promotion without deactivating the app.
  static func suppressResidentKey(_ body: () -> Void) {
    performOrderOut(suppressingResidentKey: true, deactivating: false, body)
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
    let returning = PanelKeyboard.anotherAppOwnsMenuBar
    PanelKeyboard.performOrderOut(suppressingResidentKey: returning, deactivating: returning) {
      orderOut(nil)
      orderFrontRegardless()
    }
  }

  /// Orders a non-activating panel out and, when another app owns the menu bar, suppresses
  /// resident Atd key promotion if this panel or no Atd window holds key, deactivating Atd when
  /// this panel held the keyboard.
  func orderOutReturningKeyboard() {
    performReturningOrderOut { orderOut(nil) }
  }

  /// Orders out and closes a non-activating panel inside one guarded pass so AppKit's
  /// close-time key promotion cannot wake resident Atd panels before keyboard focus returns.
  func closeReturningKeyboard() {
    performReturningOrderOut {
      orderOut(nil)
      close()
    }
  }

  func performReturningOrderOut(_ body: () -> Void) {
    let heldKey = isKeyWindow
    let anotherOwns = PanelKeyboard.anotherAppOwnsMenuBar
    PanelKeyboard.performOrderOut(
      suppressingResidentKey: (heldKey || NSApp.keyWindow == nil) && anotherOwns,
      deactivating: heldKey && anotherOwns,
      body)
  }

  /// Takes the keyboard for a control the person clicked that needs it, as a click in a text
  /// field would (`becomesKeyOnlyIfNeeded`). A non-activating panel becomes key without
  /// activating Atd; ``returnKeyboard()`` gives it back.
  func takeKeyboard() {
    guard canBecomeKey, isVisible, !isKeyWindow else { return }
    makeKey()
  }
}
