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

/// Posts a window-routed click to the target pid without moving the real cursor. For Chromium the
/// recipe primes with an off-screen `(-1,-1)` down/up pair and dual-posts (SkyLight + public), as
/// the current Cua Chromium recipe does; for AppKit a single stamped pair suffices once the
/// caller has opened a key scope (AppKit discards a background mouseDown to a non-key window). The
/// recipe is adapted from open-computer-use `SkyClickSimulation` (MIT).
enum PointerRecipes {
  private static let primerPoint = CGPoint(x: -1, y: -1)

  /// Deliver `clickCount` clicks (1 or 2). `chromium` selects the primer + dual-post variant.
  /// Returns false when an event could not be built (the caller maps that to `noRoute`).
  @discardableResult
  static func click(
    factory: EventFactory, target: PointerTarget, clickCount: Int, chromium: Bool
  ) -> Bool {
    let count = max(1, min(clickCount, 2))
    let windowPoint = CGPoint(
      x: target.screenPoint.x - target.windowBounds.origin.x,
      y: target.screenPoint.y - target.windowBounds.origin.y)
    let clickGroup = factory.newClickGroup()

    guard
      dispatch(
        factory, .mouseMoved, target.screenPoint, windowPoint, target, 0, 2, clickGroup, chromium)
    else { return false }
    if chromium {
      // Off-screen primer pair wakes the Chromium input pipeline before the real target pair.
      _ = dispatch(
        factory, .leftMouseDown, primerPoint, primerPoint, target, 1, 1, clickGroup, true)
      _ = dispatch(factory, .leftMouseUp, primerPoint, primerPoint, target, 1, 2, clickGroup, true)
      Thread.sleep(forTimeInterval: 0.1)
    }
    for pair in 1...count {
      guard
        dispatch(
          factory, .leftMouseDown, target.screenPoint, windowPoint, target, Int64(pair), 3,
          clickGroup, chromium),
        dispatch(
          factory, .leftMouseUp, target.screenPoint, windowPoint, target, Int64(pair), 3,
          clickGroup, chromium)
      else { return false }
      if pair < count { Thread.sleep(forTimeInterval: 0.08) }
    }
    return true
  }

  private static func dispatch(
    _ factory: EventFactory, _ type: CGEventType, _ screenPoint: CGPoint, _ windowPoint: CGPoint,
    _ target: PointerTarget, _ clickState: Int64, _ phase: Int64, _ clickGroup: Int64,
    _ dualPost: Bool
  ) -> Bool {
    guard let event = factory.makeMouse(type: type, screenPoint: screenPoint, button: .left) else {
      return false
    }
    factory.stampWindow(
      event, windowId: Int(target.windowId), windowPoint: windowPoint, pid: target.pid,
      phase: phase, clickState: clickState, clickGroup: clickGroup)
    factory.post(event, to: target.pid, dualPost: dualPost)
    return true
  }
}
