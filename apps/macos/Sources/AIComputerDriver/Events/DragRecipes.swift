import AIComputerDriverKit
import CoreGraphics
import Foundation

/// A window-routed in-content drag: mouse-down, a stream of dragged points, mouse-up, all stamped
/// to the target window. This drives sliders, canvases and pointer-event web widgets. A native
/// `NSDraggingSession` cannot be completed in the background (it tracks the real pointer), so if
/// a drag-image window appears the stream aborts with `dragAndDrop` rather than leaving a dangling
/// press. The abort heuristic (a new on-screen window appearing mid-drag) follows Cua's
/// `drag_and_drop_session` detection (MIT).
enum DragRecipes {
  /// Run the drag from `from` to `to` (global screen points). Throws `dragAndDrop` when a drag
  /// session window appears, `noRoute` when an event could not be built.
  static func drag(
    factory: EventFactory, pid: pid_t, windowId: CGWindowID, windowBounds: CGRect,
    from: CGPoint, to: CGPoint
  ) throws {
    let before = onScreenWindowIds()
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
    Thread.sleep(forTimeInterval: 0.05)  // clear the OS drag threshold before motion
    try abortIfDragSession(before: before)

    let steps = 10
    for step in 1...steps {
      let progress = CGFloat(step) / CGFloat(steps)
      let point = CGPoint(
        x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress)
      try send(.leftMouseDragged, point, state: 1, phase: 3)
      if step == 2 { try abortIfDragSession(before: before) }
    }
    try send(.leftMouseUp, to, state: 1, phase: 3)
  }

  private static func abortIfDragSession(before: Set<CGWindowID>) throws {
    let now = onScreenWindowIds()
    if !now.subtracting(before).isEmpty {
      throw DriverFailure(
        code: .dragAndDrop,
        message:
          "a drag-and-drop session window appeared; a native drag cannot complete in the background",
        mayHaveDispatched: true)
    }
  }

  private static func onScreenWindowIds() -> Set<CGWindowID> {
    Set(WindowList.onScreenWindows().map(\.windowId))
  }
}
