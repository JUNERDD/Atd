import AppKit

/// Base window for foreground shell windows (Settings, Welcome Guide, Generative Views, User Apps,
/// Computer Monitor) whose close must follow explicit focus-handoff policy instead of AppKit's
/// default key-window promotion.
///
/// Closing a standard `NSWindow` triggers AppKit key promotion (`_changeKeyAndMainLimitedOK:`)
/// across all ordered-in windows, which would otherwise wake a covered `ShellPanel` or auxiliary
/// floating glass panel. Routing `close()` through ``AppPresence/focusTarget(excluding:)`` and
/// ``PanelKeyboard/performOrderOut(suppressingResidentKey:deactivating:_:)`` suppresses
/// undesirable key promotion, deactivates Atd when no uncovered foreground successor remains, and
/// explicitly activates/focuses an eligible successor when one exists.
class ShellForegroundWindow: NSWindow {
  var allowsBorderlessKeyAndMain: Bool { false }
  var stepsAsideOnClose = true

  override var canBecomeKey: Bool {
    (allowsBorderlessKeyAndMain || super.canBecomeKey) && !PanelKeyboard.isReturningToFrontmostApp
  }

  override var canBecomeMain: Bool {
    allowsBorderlessKeyAndMain || super.canBecomeMain
  }

  override func close() {
    let stepsAside = stepsAsideOnClose
    defer { stepsAsideOnClose = true }
    let foregroundActive = NSApp.isActive && !PanelKeyboard.anotherAppOwnsMenuBar
    let successor = foregroundActive ? AppPresence.focusTarget(excluding: self) : nil
    let anotherOwns = PanelKeyboard.anotherAppOwnsMenuBar
    let suppress =
      (foregroundActive && successor == nil)
      || (anotherOwns && (isKeyWindow || NSApp.keyWindow == nil))
    PanelKeyboard.performOrderOut(
      suppressingResidentKey: suppress,
      deactivating: stepsAside && foregroundActive && successor == nil
    ) {
      super.close()
    }
    if let successor, successor.isVisible, successor.canBecomeKey {
      if !NSApp.isActive { NSApp.activate() }
      successor.makeKeyAndOrderFront(nil)
    }
  }
}
