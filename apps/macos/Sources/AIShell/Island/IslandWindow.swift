import AICore
import AppKit
import Carbon.HIToolbox
import SwiftUI

/// The command island's window: a borderless, non-activating panel that is a transparent canvas
/// for every shape the island takes (``IslandModel/canvas``: commands' default canvas, or the
/// work area reserved for the recording until the island hides), at status-bar level on every
/// Space and beside full-screen apps, outside the window cycle. It draws no shadow of its own;
/// the glass draws its own. Clicks on its transparent pixels pass to the windows below.
///
/// It takes the keyboard only while a card is up (``keyCapable``: the options card, the answer
/// card), and then without activating Atd, as the task panel does (``ShellPanel``): the app in
/// front keeps the menu bar. Key presses reach ``onKeyDown`` before anything in the window, which
/// lets the card read its keys ahead of the filter field, and key equivalents reach
/// ``onKeyEquivalent`` ahead of the window's views and the menus, which lets the answer card
/// take ⌘C; a press neither takes goes on as usual. While a card's field is still to take the
/// keyboard, presses wait for it instead (``awaitsField``). Scrolling over the card goes to
/// ``onScroll``. Its glass keeps the active edge while the window is not key, as the other glass
/// HUDs' do (``ActiveGlassPanel``).
final class IslandWindow: ActiveGlassPanel, FloatingHoverHost {
  var keyCapable = false
  lazy var pointerHover = IslandPointerHover()
  var hoverRegions: FloatingHoverRegions { pointerHover.regions }
  var hoverInteractive: Bool { acceptsPointerEvents }
  /// Departing controls stop receiving pointer input. Leave `ignoresMouseEvents` unset:
  /// explicitly setting it to false makes even this canvas's transparent pixels take events.
  /// WindowServer must keep deriving the input region from the drawn glass, as for MiniPanel.
  var acceptsPointerEvents = true
  /// A key press while the window is key: true when it was taken.
  var onKeyDown: ((NSEvent) -> Bool)?
  /// A key equivalent while the window is key: true when it was taken.
  var onKeyEquivalent: ((NSEvent) -> Bool)?
  /// A scroll over the window: true when it was taken.
  var onScroll: ((NSEvent) -> Bool)?
  /// A card with a field is arriving and no field editor has the keyboard yet: set as the
  /// controller mounts the card, over once a field editor has the keyboard. Key presses wait
  /// meanwhile and then go on in order, so what is typed as the card arrives reaches its field
  /// through its input method. Escape goes at once and drops them, as the card's going or the
  /// window's giving up the keyboard does.
  var awaitsField = false {
    didSet { if !awaitsField { typedAhead = [] } }
  }
  private var typedAhead: [NSEvent] = []

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
    if !acceptsPointerEvents {
      switch event.type {
      case .leftMouseDown, .leftMouseUp, .leftMouseDragged,
        .rightMouseDown, .rightMouseUp, .rightMouseDragged,
        .otherMouseDown, .otherMouseUp, .otherMouseDragged,
        .mouseMoved, .scrollWheel, .gesture, .beginGesture, .endGesture,
        .magnify, .rotate, .swipe, .pressure:
        return
      default: break
      }
    }
    if event.type == .keyDown, awaitsField {
      guard Int(event.keyCode) == kVK_Escape else { return typedAhead.append(event) }
      typedAhead = []
    }
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

  /// A field taking the keyboard keeps its text with the caret after it, where AppKit would
  /// select it all: a card keeps its draft through a page, an attachment or the options sheet,
  /// and the next key goes on from there rather than replacing it (a click still puts the caret
  /// where it lands). Presses waiting for a field go to it once the change is done.
  @discardableResult
  override func makeFirstResponder(_ responder: NSResponder?) -> Bool {
    let edited = editedField
    let made = super.makeFirstResponder(responder)
    if let editor = editingField, editor.isFieldEditor, editedField !== edited {
      editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
      if awaitsField { Task { [weak self] in self?.sendTypedAhead() } }
    }
    return made
  }

  /// The field the field editor edits, while one has the keyboard.
  private var editedField: AnyObject? {
    guard let editor = editingField, editor.isFieldEditor else { return nil }
    return editor.delegate
  }

  override func resignKey() {
    super.resignKey()
    typedAhead = []
  }

  /// The presses typed ahead go on, in order, as they came (key equivalents included), now that
  /// a field editor has the keyboard.
  private func sendTypedAhead() {
    guard awaitsField, editingField?.isFieldEditor == true else { return }
    let presses = typedAhead
    awaitsField = false
    for press in presses { NSApp.sendEvent(press) }
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
