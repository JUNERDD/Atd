import AICore
import AIWidgetRender
import AppKit

/// A desktop pin's resize corners (decisions D5 v1.3 to v1.6): the four corners of every pin,
/// which resizes freely within the sizes its layouts handle well. Each shows the frame-resize
/// cursor for its place, and a press there that travels resizes the pin, the opposite corner
/// held, instead of moving it (``DesktopPinWindow``).
///
/// Atd is seldom the active app while the pointer is on the desktop. The window server ignores
/// an inactive app's cursor changes, and hands it tracking events late or not at all when the
/// pointer moves fast (``SelectionToolbarHover`` meets both). So the pin's own mouse moves set
/// the cursor through ``BackgroundCursor``; a `cursorUpdate` tracking area would not help, as
/// AppKit does not support one that stays active in an inactive app. While a cursor shows, a
/// display link checks on every frame which corner the pointer is on, if any, and whether
/// another window covers the pin there, and follows as soon as that changes, whether or not an
/// event said so.
final class DesktopPinCorner: NSResponder {
  /// The ways the corners' cursors point: out from the smallest size, in from the largest. Nil
  /// for a pin that cannot resize, which then has no resize corners. A change applies at once.
  var directions: NSCursor.FrameResizeDirection.Set? {
    didSet {
      guard let shown else { return }
      if directions == nil { hide() } else { show(shown) }
    }
  }

  private weak var view: NSView?
  /// The corner whose cursor this set, until it puts the arrow back.
  private var shown: DesktopPinGeometry.Corner?
  private var link: CADisplayLink?

  /// Follows the pointer over `view`, the pin's content.
  init(view: NSView) {
    self.view = view
    super.init()
    // `activeAlways`: the moves arrive while another app is active, as one nearly always is.
    view.addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.activeAlways, .mouseEnteredAndExited, .mouseMoved, .inVisibleRect],
        owner: self))
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The corner a point in the window's coordinates lies on, when the pin has resize corners.
  func corner(at point: NSPoint) -> DesktopPinGeometry.Corner? {
    guard directions != nil, let size = view?.bounds.size else { return nil }
    return DesktopPinGeometry.corner(
      atX: point.x, y: point.y, size: WindowSize(width: size.width, height: size.height),
      radius: WidgetCard.cornerRadius)
  }

  /// The pointer is at `point`, in the window's coordinates: a corner's cursor on that corner,
  /// else the arrow back if this had changed it.
  func update(at point: NSPoint) {
    if let corner = corner(at: point) { show(corner) } else { hide() }
  }

  /// Shows `corner`'s cursor, which a resize keeps wherever the pointer travels, and watches for
  /// the pointer leaving the corner.
  func show(_ corner: DesktopPinGeometry.Corner) {
    guard let directions, let view else { return }
    BackgroundCursor.enable()
    NSCursor.frameResize(position: corner.cursorPosition, directions: directions).set()
    shown = corner
    guard link == nil else { return }
    let link = view.displayLink(target: self, selector: #selector(watch(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  /// Puts the arrow back if this had changed the cursor, and stops watching.
  func hide() {
    link?.invalidate()
    link = nil
    guard shown != nil else { return }
    shown = nil
    NSCursor.arrow.set()
  }

  override func mouseEntered(with event: NSEvent) { update(at: event.locationInWindow) }

  override func mouseMoved(with event: NSEvent) { update(at: event.locationInWindow) }

  override func mouseExited(with event: NSEvent) {
    // A resize keeps its cursor wherever the pointer travels; its release decides.
    guard NSEvent.pressedMouseButtons & 1 == 0 else { return }
    hide()
  }

  /// Every frame while a cursor shows; a held left button keeps it until the release.
  @objc private func watch(_ link: CADisplayLink) {
    guard let window = view?.window, window.isVisible else { return hide() }
    guard NSEvent.pressedMouseButtons & 1 == 0 else { return }
    let mouse = NSEvent.mouseLocation
    let top = NSWindow.windowNumber(at: mouse, belowWindowWithWindowNumber: 0)
    let corner =
      top == window.windowNumber ? corner(at: window.convertPoint(fromScreen: mouse)) : nil
    switch corner {
    case nil: hide()
    case let corner? where corner != shown: show(corner)
    default: break
    }
  }
}

extension DesktopPinGeometry.Corner {
  /// Where the frame-resize cursor for this corner points from.
  var cursorPosition: NSCursor.FrameResizePosition {
    switch self {
    case .topLeft: .topLeft
    case .topRight: .topRight
    case .bottomLeft: .bottomLeft
    case .bottomRight: .bottomRight
    }
  }
}
