import AICore
import AppKit
import SwiftUI

/// The command island's window: a borderless, non-activating panel that is a transparent canvas
/// for every shape the island takes (``IslandMetrics/canvas``), at status-bar level on every
/// Space and beside full-screen apps, outside the window cycle. It draws no shadow of its own;
/// the glass draws its own. Clicks on its transparent pixels pass to the windows below.
///
/// It takes the keyboard only while a card is up (``keyCapable``: the options card, the answer
/// card), and then without activating Atd, as the task panel does (``ShellPanel``): the app in
/// front keeps the menu bar. Key presses reach ``onKeyDown`` before anything in the window, which
/// lets the card read its keys ahead of the filter field, and key equivalents reach
/// ``onKeyEquivalent`` ahead of the window's views and the menus, which lets the answer card
/// take ⌘C; a press neither takes goes on as usual. Scrolling over the card goes to
/// ``onScroll``.
final class IslandWindow: NSPanel {
  var keyCapable = false
  /// A key press while the window is key: true when it was taken.
  var onKeyDown: ((NSEvent) -> Bool)?
  /// A key equivalent while the window is key: true when it was taken.
  var onKeyEquivalent: ((NSEvent) -> Bool)?
  /// A scroll over the window: true when it was taken.
  var onScroll: ((NSEvent) -> Bool)?

  init(content: NSView) {
    let canvas = IslandMetrics.canvas
    super.init(
      contentRect: NSRect(x: 0, y: 0, width: canvas.width, height: canvas.height),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    level = .statusBar
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
    contentView = content
  }

  override var canBecomeKey: Bool { keyCapable }
  override var canBecomeMain: Bool { false }

  /// Where the owner puts it: a borderless window is otherwise kept below the menu bar.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }

  override func sendEvent(_ event: NSEvent) {
    switch event.type {
    case .keyDown where onKeyDown?(event) == true: return
    case .scrollWheel where onScroll?(event) == true: return
    default: super.sendEvent(event)
    }
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if onKeyEquivalent?(event) == true { return true }
    return super.performKeyEquivalent(with: event)
  }

  /// The text field that has the keyboard: typing into the options card's filter, or selecting
  /// in the answer card's answer.
  var editingField: NSTextView? { firstResponder as? NSTextView }
}

/// The island's SwiftUI content. It takes the first click while Atd is inactive, which is
/// always for this window, so a press on a button acts at once; it never resizes its window.
final class IslandHostingView: NSHostingView<IslandView> {
  required init(rootView: IslandView) {
    super.init(rootView: rootView)
    sizingOptions = []
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
