import AppKit

/// A panel that never takes the keyboard: clicks act on its buttons, keys stay with the app
/// that has the selection. Its glass keeps the capture toolbar's active edge all the same
/// (``ActiveGlassPanel``).
final class ToolbarWindow: ActiveGlassPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// The selection toolbar's window, and its menus': a borderless panel that draws nothing of
  /// its own, stays up while Atd is inactive, and shows on every Space and beside full-screen
  /// apps without joining the window cycle.
  static func selectionToolbar() -> ToolbarWindow {
    let window = ToolbarWindow(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .popUpMenu
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.becomesKeyOnlyIfNeeded = true
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle,
    ]
    return window
  }
}
