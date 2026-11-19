import AppKit

/// Non-activating summonable task panel (S7); direct clicks activate natively when available, and
/// hidden `canBecomeKey` stays false outside shortcut handoff so resigning HUDs skip it.
final class ShellPanel: NSPanel {
  private var nativeClickActivation = false
  var retainsKeyForHandoff = false

  /// Configured once for the task panel; mini panels keep non-activating clicks for selection.
  func configureClickActivation() {
    nativeClickActivation = PanelClickActivation.configure(self)
  }

  override var canBecomeKey: Bool {
    !PanelKeyboard.isReturningToFrontmostApp
      && (retainsKeyForHandoff || (alphaValue > 0 && !ignoresMouseEvents && !isMiniaturized))
  }
  override var canBecomeMain: Bool { false }

  override func sendEvent(_ event: NSEvent) {
    // Fall back to explicit activation on click only when the native capability is unavailable.
    if !nativeClickActivation, canBecomeKey,
      [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
    {
      NSApp.activate()
    }
    super.sendEvent(event)
  }
}
