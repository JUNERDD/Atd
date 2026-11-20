import CoreGraphics
import Foundation

/// A window-routed scroll-wheel event, stamped with the window fields so WindowServer delivers it
/// to the target window at a window-local point rather than wherever the real pointer sits. Line
/// or continuous pixel units; the host supplies signed deltas. Adapted from open-computer-use
/// (MIT).
enum ScrollRecipes {
  @discardableResult
  static func scroll(
    factory: EventFactory, target: PointerTarget, deltaX: Double, deltaY: Double,
    pixels: Bool = false
  ) -> Bool {
    let windowPoint = CGPoint(
      x: target.screenPoint.x - target.windowBounds.origin.x,
      y: target.screenPoint.y - target.windowBounds.origin.y)
    guard
      let dx = Int32(exactly: deltaX.rounded()),
      let dy = Int32(exactly: deltaY.rounded()),
      let event = factory.makeScroll(deltaX: dx, deltaY: dy, pixels: pixels)
    else {
      return false
    }
    // Set screen location before stamping window-local coordinates: CGEventSetWindowLocation must
    // run last so updating `location` does not reset the window-local point.
    event.location = target.screenPoint
    factory.stampWindow(
      event, windowId: Int(target.windowId), windowPoint: windowPoint, pid: target.pid,
      phase: 0, clickState: 0, clickGroup: factory.newClickGroup())
    factory.post(event, to: target.pid, dualPost: false)
    return true
  }
}
