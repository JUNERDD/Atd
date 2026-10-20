import AIComputerDriverKit
import CoreGraphics
import Foundation

/// A window-routed in-content drag: mouse-down, a stream of dragged points, mouse-up, all stamped
/// to the target window. This drives sliders, canvases and pointer-event web widgets. A native
/// `NSDraggingSession` cannot be completed in the background (it tracks the real pointer), so when
/// the target opens a drag-image window the stream stops and the drag fails with `dragAndDrop`.
/// Once the mouse-down is posted, every exit (completion, a drag session, an event that could not
/// be built) posts a mouse-up at the last point sent first, so the target never keeps a pressed
/// button. The detection follows Cua's `drag_and_drop_session` check (MIT): a window of the target
/// pid at the dragging window level that was not on screen before the drag. Windows other
/// processes open, and the target's own menus and tooltips, do not abort a drag.
enum DragRecipes {
  private static let steps = 10

  /// Run the drag from `from` to `to` (global screen points). Throws `dragAndDrop` when a drag
  /// session window appears, `noRoute` when an event could not be built. A failure after the
  /// mouse-down reports `mayHaveDispatched`, because the press already reached the target.
  static func drag(
    factory: EventFactory, pid: pid_t, windowId: CGWindowID, windowBounds: CGRect,
    from: CGPoint, to: CGPoint
  ) throws {
    let before = dragImageWindowIds(pid: pid)
    func windowPoint(_ screen: CGPoint) -> CGPoint {
      CGPoint(x: screen.x - windowBounds.origin.x, y: screen.y - windowBounds.origin.y)
    }
    func send(_ type: CGEventType, _ screen: CGPoint, state: Int64, phase: Int64) throws {
      guard let event = factory.makeMouse(type: type, screenPoint: screen, button: .left) else {
        throw DriverFailure(code: .noRoute, message: "could not build drag event")
      }
      factory.stampWindow(
        event, windowId: Int(windowId), windowPoint: windowPoint(screen), pid: pid, phase: phase,
        clickState: state, clickGroup: factory.newClickGroup())
      factory.post(event, to: pid, dualPost: false)
    }

    try send(.mouseMoved, from, state: 0, phase: 2)
    try send(.leftMouseDown, from, state: 1, phase: 1)

    var lastPoint = from
    do {
      Thread.sleep(forTimeInterval: 0.05)  // clear the OS drag threshold before motion
      for step in 1...steps {
        let progress = CGFloat(step) / CGFloat(steps)
        let point = CGPoint(
          x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
        try send(.leftMouseDragged, point, state: 1, phase: 3)
        lastPoint = point
        try abortIfDragSession(pid: pid, before: before)
      }
      try send(.leftMouseUp, to, state: 1, phase: 3)
    } catch {
      // The press is down: release where the gesture stands. Best effort, because the failure
      // being reported may itself be an event that could not be built.
      try? send(.leftMouseUp, lastPoint, state: 1, phase: 3)
      guard var failure = error as? DriverFailure else { throw error }
      failure.mayHaveDispatched = true
      throw failure
    }
  }

  private static func abortIfDragSession(pid: pid_t, before: Set<CGWindowID>) throws {
    if !dragImageWindowIds(pid: pid).subtracting(before).isEmpty {
      throw DriverFailure(
        code: .dragAndDrop,
        message:
          "a drag-and-drop session window appeared; a native drag cannot complete in the background",
        mayHaveDispatched: true)
    }
  }

  /// The target's on-screen windows at the dragging level. AppKit shows the image of a live (or
  /// sliding-back) drag-and-drop session in a window of the source app at that level.
  private static func dragImageWindowIds(pid: pid_t) -> Set<CGWindowID> {
    let level = Int(CGWindowLevelForKey(.draggingWindow))
    return Set(
      WindowList.onScreenWindows().filter { $0.ownerPID == pid && $0.layer == level }
        .map(\.windowId))
  }
}
