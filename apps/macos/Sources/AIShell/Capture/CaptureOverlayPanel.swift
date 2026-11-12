import AppKit

/// One capture overlay window per display (decision D7): borderless, non-activating, above
/// the menu bar, the Dock and open menus, on every Space and over full-screen apps. Pointer and
/// hover interaction start while `allowsKey` is still false; once the invoking shortcut's keys
/// are released, the session enables `allowsKey` and activates the app for the keyboard and input
/// methods. A text command's result card in it follows the pointer with the window's own clock
/// (``FloatingHoverHost``), as the island's controls do.
final class CaptureOverlayPanel: NSPanel, FloatingHoverHost {
  var allowsKey = false
  lazy var pointerHover = IslandPointerHover()
  var hoverRegions: FloatingHoverRegions { pointerHover.regions }
  var hoverInteractive: Bool { isVisible }

  init(screen: NSScreen, content: NSView) {
    super.init(
      contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    level = .screenSaver
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    // With Reduce Motion the default animation zooms the window in, so the frozen image would
    // visibly sit off its display for a moment.
    animationBehavior = .none
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    isMovable = false
    isExcludedFromWindowsMenu = true
    acceptsMouseMovedEvents = true
    contentView = content
    setFrame(screen.frame, display: false)
  }

  override var canBecomeKey: Bool { allowsKey }
  override var canBecomeMain: Bool { false }

  /// A borderless window is otherwise kept below the menu bar; the overlay covers it, because
  /// the frozen image does.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}
