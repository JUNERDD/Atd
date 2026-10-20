import CoreGraphics
import Foundation

/// A window-routed scroll-wheel event, stamped with the window fields so WindowServer delivers it
/// to the target window at a window-local point rather than wherever the real pointer sits. Line
/// units; the host supplies signed line deltas. Adapted from open-computer-use (MIT).
enum ScrollRecipes {
  @discardableResult
  static func scroll(
    factory: EventFactory, target: PointerTarget, deltaX: Double, deltaY: Double
  ) -> Bool {
    let windowPoint = CGPoint(
      x: target.screenPoint.x - target.windowBounds.origin.x,
      y: target.screenPoint.y - target.windowBounds.origin.y)
    guard let event = factory.makeScroll(deltaX: Int32(deltaX), deltaY: Int32(deltaY)) else {
      return false
    }
    factory.stampWindow(
      event, windowId: Int(target.windowId), windowPoint: windowPoint, pid: target.pid,
      phase: 0, clickState: 0, clickGroup: factory.newClickGroup())
    factory.post(event, to: target.pid, dualPost: false)
    return true
  }
}
