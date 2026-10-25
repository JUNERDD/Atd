import CoreGraphics
import Foundation

/// A window-coordinate click target: the global screen point, the window it belongs to, and the
/// window's bounds (to derive the window-local point the event is stamped with).
struct PointerTarget {
  let pid: pid_t
  let windowId: CGWindowID
  let windowBounds: CGRect
  let screenPoint: CGPoint
}

/// Posts a window-routed click to the target pid without moving the real cursor. The caller runs
/// it inside a target-only key scope: a background mouse-down to a window that is not key never
/// reaches its content (AppKit discards it, and Chromium takes a first mouse only in the active
/// window), and once the window is key one stamped pair per click does for every toolkit. The
/// recipe is adapted from open-computer-use `SkyClickSimulation` (MIT).
enum PointerRecipes {
  /// How long the target gets to take the click before the scope hands key back: Chromium passes
  /// input to its renderer asynchronously, and losing key first would blur the page mid-click.
  private static let settle: TimeInterval = 0.05

  /// Deliver `clickCount` clicks (1 or 2). Returns false when an event could not be built (the
  /// caller maps that to `noRoute`).
  @discardableResult
  static func click(factory: EventFactory, target: PointerTarget, clickCount: Int) -> Bool {
    let count = max(1, min(clickCount, 2))
    let windowPoint = CGPoint(
      x: target.screenPoint.x - target.windowBounds.origin.x,
      y: target.screenPoint.y - target.windowBounds.origin.y)
    let clickGroup = factory.newClickGroup()

    guard dispatch(factory, .mouseMoved, target.screenPoint, windowPoint, target, 0, 2, clickGroup)
    else { return false }
    for pair in 1...count {
      guard
        dispatch(
          factory, .leftMouseDown, target.screenPoint, windowPoint, target, Int64(pair), 3,
          clickGroup),
        dispatch(
          factory, .leftMouseUp, target.screenPoint, windowPoint, target, Int64(pair), 3,
          clickGroup)
      else { return false }
      if pair < count { Thread.sleep(forTimeInterval: 0.08) }
    }
    Thread.sleep(forTimeInterval: settle)
    return true
  }

  private static func dispatch(
    _ factory: EventFactory, _ type: CGEventType, _ screenPoint: CGPoint, _ windowPoint: CGPoint,
    _ target: PointerTarget, _ clickState: Int64, _ phase: Int64, _ clickGroup: Int64
  ) -> Bool {
    guard let event = factory.makeMouse(type: type, screenPoint: screenPoint, button: .left) else {
      return false
    }
    factory.stampWindow(
      event, windowId: Int(target.windowId), windowPoint: windowPoint, pid: target.pid,
      phase: phase, clickState: clickState, clickGroup: clickGroup)
    factory.post(event, to: target.pid, dualPost: false)
    return true
  }
}
