import AICore
import AppKit
import Carbon.HIToolbox

/// The lightbox's window: a borderless, non-activating panel over the whole screen the island is
/// on, one level above the island, on every Space and beside full-screen apps, outside the window
/// cycle. It takes the keyboard while it shows without activating Atd, as the island's cards do
/// (``IslandWindow``): the app in front keeps the menu bar, which the scrim covers. Key presses
/// reach ``onKeyDown``, releases ``onKeyUp`` and modifier changes ``onFlagsChanged`` before
/// anything in the window, and key equivalents reach ``onKeyEquivalent`` before the menus. Its controls follow the pointer with their own clock
/// (``IslandPointerHover``), as the island's do, so hover and cursors keep up while another app is
/// active.
final class IslandLightboxWindow: ActiveGlassPanel, FloatingHoverHost {
  lazy var pointerHover = IslandPointerHover()
  var hoverRegions: FloatingHoverRegions { pointerHover.regions }
  var hoverInteractive: Bool { isVisible }
  /// A key press while the window is key: true when it was taken.
  var onKeyDown: ((NSEvent) -> Bool)?
  /// A key let go while the window is key: true when it was taken.
  var onKeyUp: ((NSEvent) -> Bool)?
  /// The modifier keys changed while the window is key; the event goes on either way.
  var onFlagsChanged: ((NSEvent) -> Void)?
  /// A key equivalent while the window is key: true when it was taken.
  var onKeyEquivalent: ((NSEvent) -> Bool)?
  /// The window gave up the keyboard; releases may now reach a different window or app.
  var onKeyboardLost: (() -> Void)?

  init(content: NSView) {
    super.init(
      contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = false
    isMovable = false
    isExcludedFromWindowsMenu = true
    isReleasedWhenClosed = false
    animationBehavior = .none
    acceptsMouseMovedEvents = true
    contentView = content
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  /// Where the owner puts it, over the menu bar too: a borderless window is otherwise kept
  /// below it.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }

  override func sendEvent(_ event: NSEvent) {
    switch event.type {
    case .keyDown where !inputMethodActive:
      if event.isARepeat, Int(event.keyCode) == kVK_Escape { return }
      if onKeyDown?(event) == true { return }
    case .keyUp: if onKeyUp?(event) == true { return }
    case .flagsChanged: onFlagsChanged?(event)
    default: break
    }
    super.sendEvent(event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if !inputMethodActive, onKeyEquivalent?(event) == true { return true }
    return super.performKeyEquivalent(with: event)
  }

  /// A composition keeps every key, including Escape, before the lightbox's close fallback.
  private var inputMethodActive: Bool {
    (firstResponder as? NSTextView)?.hasMarkedText() == true
  }

  override func resignKey() {
    super.resignKey()
    onKeyboardLost?()
  }

  /// Escape that nothing in the window took still closes it (``IslandLightbox``), so it never
  /// beeps.
  override func cancelOperation(_ sender: Any?) {}
}
