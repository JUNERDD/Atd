import AICore
import AppKit

/// A desktop pin's window: a borderless, non-activating panel one level above Finder's desktop
/// icons (`kCGDesktopIconWindowLevel` + 1), so it takes its own clicks while every app window
/// stays above it. It shows on every Space and holds still in Mission Control and Show Desktop
/// like a system widget, never joins full-screen apps or tiling, and never becomes key or main.
/// Its frame is the card's; the window server draws the shadow outside it, and the transparent
/// corners let clicks through.
///
/// A left press is held here rather than given to SwiftUI. Once the mouse travels more than
/// ``DesktopPinGeometry/moveThreshold`` the window follows it and reports the new frame on
/// release (``onMoved``). A press on a resize corner (``DesktopPinCorner``) resizes instead: the
/// window reports the corner and how far the pointer travels (``onResize``), the owner sizes the
/// pin through ``place(_:)``, and the release ends the resize (``onResized``).
/// SwiftUI never sees such a press, so no link fires after a move or a resize; a release without
/// travel posts the press and the release again, which then pass through to SwiftUI in order and
/// run the click. Posting rather than sending them from here keeps the order right even for a
/// view that tracks the mouse in a loop of its own. A right click or a control-click opens the
/// menu ``makeMenu`` builds.
final class DesktopPinWindow: NSPanel {
  static let level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)

  /// The frame a move ended at; the owner keeps it inside the work area and saves it.
  var onMoved: ((ScreenRect) -> Void)?
  /// A resize from this corner: how far the pointer travelled since the press, in AppKit's global
  /// points (y up). The owner resizes the pin, the opposite corner held.
  var onResize: ((DesktopPinGeometry.Corner, _ dx: Double, _ dy: Double) -> Void)?
  /// The resize ended: the owner keeps the size and the frame it showed last.
  var onResized: (() -> Void)?
  /// The context menu, built fresh in the current language each time it opens.
  var makeMenu: (() -> NSMenu?)?
  /// The ways the resize corners' cursors point; nil for a pin that cannot resize.
  var resizeDirections: NSCursor.FrameResizeDirection.Set? {
    get { corners.directions }
    set { corners.directions = newValue }
  }

  private struct Press {
    let down: NSEvent
    let start: NSPoint
    let origin: NSPoint
    /// The resize corner it began on: travel resizes the pin rather than moving it.
    let corner: DesktopPinGeometry.Corner?
    var moving = false
  }
  private var press: Press?
  /// The replayed press and release still to pass through.
  private var replaying: [NSEvent] = []
  private let corners: DesktopPinCorner

  init(model: DesktopPinModel, frame: NSRect) {
    let host = DesktopPinHostingView(rootView: DesktopPinView(model: model))
    corners = DesktopPinCorner(view: host)
    super.init(
      contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    level = Self.level
    collectionBehavior = [
      .canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone, .fullScreenDisallowsTiling,
    ]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = true
    // NSPanel hides on deactivation by default, and Atd is an accessory app.
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = true
    isMovable = false
    isExcludedFromWindowsMenu = true
    isReleasedWhenClosed = false
    animationBehavior = .none
    // The owner sizes the window; SwiftUI must not add size constraints of its own.
    host.sizingOptions = []
    contentView = host
  }

  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  /// Moves and resizes the window, redrawing the shadow for the new shape.
  func place(_ frame: ScreenRect) {
    let rect = NSRect(frame)
    guard rect != self.frame else { return }
    setFrame(rect, display: true)
    invalidateShadow()
  }

  /// A pin removed under the pointer leaves the arrow, not its resize cursor.
  override func close() {
    corners.hide()
    super.close()
  }

  override func sendEvent(_ event: NSEvent) {
    if let index = replayIndex(of: event) {
      replaying.remove(at: index)
      return super.sendEvent(event)
    }
    switch event.type {
    case .rightMouseDown:
      showMenu(for: event)
    case .leftMouseDown:
      if event.modifierFlags.contains(.control) { return showMenu(for: event) }
      press = Press(
        down: event, start: NSEvent.mouseLocation, origin: frame.origin,
        corner: corners.corner(at: event.locationInWindow))
    case .leftMouseDragged where press != nil:
      follow()
    case .leftMouseUp where press != nil:
      release(event)
    default:
      super.sendEvent(event)
    }
  }

  private func follow() {
    guard var press else { return }
    let mouse = NSEvent.mouseLocation
    let (dx, dy) = (mouse.x - press.start.x, mouse.y - press.start.y)
    if !press.moving, DesktopPinGeometry.isMove(dx: dx, dy: dy) {
      press.moving = true
      if let corner = press.corner { corners.show(corner) }
    }
    self.press = press
    guard press.moving else { return }
    if let corner = press.corner {
      onResize?(corner, dx, dy)
    } else {
      setFrameOrigin(NSPoint(x: press.origin.x + dx, y: press.origin.y + dy))
    }
  }

  private func release(_ up: NSEvent) {
    guard let press else { return }
    self.press = nil
    if !press.moving {
      replaying = [press.down, up]
      postEvent(press.down, atStart: false)
      postEvent(up, atStart: false)
    } else if press.corner != nil {
      onResized?()
      // The pin may have a new size and place: the cursor follows what is now under the pointer.
      corners.update(at: convertPoint(fromScreen: NSEvent.mouseLocation))
    } else {
      onMoved?(ScreenRect(frame))
    }
  }

  /// The replayed event this is, matched by value in case the queue hands back a copy. Only left
  /// mouse events are compared: `eventNumber` raises for other types.
  private func replayIndex(of event: NSEvent) -> Int? {
    guard !replaying.isEmpty, event.type == .leftMouseDown || event.type == .leftMouseUp else {
      return nil
    }
    return replaying.firstIndex {
      $0.type == event.type && $0.timestamp == event.timestamp
        && $0.eventNumber == event.eventNumber
    }
  }

  private func showMenu(for event: NSEvent) {
    guard let menu = makeMenu?(), let view = contentView else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: view)
  }

  /// VoiceOver's show-menu action: the menu at the pin's top-left corner.
  func showMenuForAccessibility() {
    guard let menu = makeMenu?(), let view = contentView else { return }
    let corner = NSPoint(
      x: view.bounds.minX, y: view.isFlipped ? view.bounds.minY : view.bounds.maxY)
    menu.popUp(positioning: nil, at: corner, in: view)
  }
}
