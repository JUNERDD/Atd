import AICore
import AppKit
import QuartzCore

/// The live pointer's window on one display: a borderless, non-activating panel that ignores the
/// mouse and covers the whole display, like the typing trace's (``InsertionTraceOverlay``) but
/// open for as long as marks are on its display. It never becomes key or main, so no app loses
/// the keyboard or its frontmost state, and clicks pass through it to the windows below. The
/// window belongs to the Atd process, so ``DisplayFreezer`` and ``WindowSnapshot`` already leave
/// it out of their images.
///
/// Marks go straight into ``canvas``, which is not flipped: callers lay out in the display's view
/// space (Quartz less the display's origin, y down) and convert with ``PointerCanvas/layer(_:)``,
/// so text and shapes render upright without relying on a flipped container.
final class PointerOverlay: PointerCanvas {
  let displayID: CGDirectDisplayID
  /// The display's bounds in Quartz points.
  let bounds: CGRect
  /// Backing pixels per point on this display; displays can differ.
  let scale: CGFloat
  let canvas = CALayer()
  private let window: NSPanel

  init(screen: NSScreen, displayID: CGDirectDisplayID, bounds: CGRect) {
    self.displayID = displayID
    self.bounds = bounds
    scale = screen.backingScaleFactor
    window = Self.makeWindow()
    window.setFrame(screen.frame, display: false)
    let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
    view.layer = canvas
    view.wantsLayer = true
    canvas.frame = view.bounds
    canvas.contentsScale = scale
    window.contentView = view
  }

  /// Whether the window is on screen.
  var isShowing: Bool { window.isVisible }
  /// Whether nothing is drawn, fading marks included.
  var isEmpty: Bool { canvas.sublayers?.isEmpty ?? true }

  /// Puts the window on screen without activating Atd.
  func show() {
    guard !window.isVisible else { return }
    window.orderFrontRegardless()
  }

  func hide() {
    window.orderOut(nil)
  }

  private static func makeWindow() -> NSPanel {
    let window = PointerPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .popUpMenu
    window.hidesOnDeactivate = false
    window.canHide = false
    window.isReleasedWhenClosed = false
    window.isExcludedFromWindowsMenu = true
    window.animationBehavior = .none
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle,
    ]
    return window
  }
}

/// A panel that can never take the keyboard or become the main window.
private final class PointerPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}
