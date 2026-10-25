import CoreGraphics
import Foundation

/// Builds and posts window-routed synthetic events. Every event is tagged so a passive monitor
/// can tell agent input from the user's (plan I8): the factory posts from a private event-source
/// state (so the agent's modifier/button state never pollutes the user's combined session state)
/// whose user data carries an Atd marker plus the driver generation. Flags are set explicitly on
/// every event so a physically held modifier never turns an agent click into a modified click
/// (A2 conclusion 16). The window-field stamping recipe follows open-computer-use / Cua (MIT).
final class EventFactory: @unchecked Sendable {
  /// The high bits identify Atd; the low 32 bits carry the driver generation.
  static let markerTag: Int64 = 0x0A1D_0000_0000_0000

  private let source: CGEventSource?
  let generation: Int

  private enum Field {
    static let gesturePhase: UInt32 = 0
    static let clickState: UInt32 = 1
    static let buttonNumber: UInt32 = 3
    static let subtype: UInt32 = 7
    static let targetPID: UInt32 = 40
    static let windowNumber: UInt32 = 51
    static let clickGroupID: UInt32 = 58
    static let windowUnderPointer: UInt32 = 91
    static let handlingWindowUnderPointer: UInt32 = 92
  }

  private let marker: Int64

  init(generation: Int) {
    self.generation = generation
    self.marker = Self.markerTag | Int64(generation & 0xFFFF_FFFF)
    // A private source keeps the agent's synthetic modifier/button state out of the user's
    // combined session state. The Atd marker is stamped per event (the source-user-data field)
    // rather than on the source, so it survives the SkyLight re-encode a passive monitor reads.
    self.source = CGEventSource(stateID: .privateState)
  }

  /// Tag the event with the Atd marker so a passive monitor can attribute it to the agent.
  private func mark(_ event: CGEvent) {
    event.setIntegerValueField(.eventSourceUserData, value: marker)
  }

  func makeMouse(type: CGEventType, screenPoint: CGPoint, button: CGMouseButton) -> CGEvent? {
    guard
      let event = CGEvent(
        mouseEventSource: source, mouseType: type, mouseCursorPosition: screenPoint,
        mouseButton: button)
    else { return nil }
    event.flags = []
    mark(event)
    return event
  }

  func makeScroll(deltaX: Int32, deltaY: Int32) -> CGEvent? {
    guard
      let event = CGEvent(
        scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: deltaY,
        wheel2: deltaX,
        wheel3: 0)
    else { return nil }
    event.flags = []
    mark(event)
    return event
  }

  func makeKey(virtualKey: CGKeyCode, keyDown: Bool, flags: CGEventFlags) -> CGEvent? {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: virtualKey, keyDown: keyDown)
    else { return nil }
    event.flags = flags
    mark(event)
    return event
  }

  func makeUnicode(_ scalars: [UniChar]) -> (down: CGEvent, up: CGEvent)? {
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
      let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    else { return nil }
    scalars.withUnsafeBufferPointer { pointer in
      guard let base = pointer.baseAddress else { return }
      down.keyboardSetUnicodeString(stringLength: pointer.count, unicodeString: base)
      up.keyboardSetUnicodeString(stringLength: pointer.count, unicodeString: base)
    }
    down.flags = []
    up.flags = []
    mark(down)
    mark(up)
    return (down, up)
  }

  /// Stamp the window-routing fields (window number, window-under-pointer) and the window-local
  /// location so WindowServer delivers the event to `windowId` regardless of the real pointer.
  func stampWindow(
    _ event: CGEvent, windowId: Int, windowPoint: CGPoint, pid: pid_t, phase: Int64,
    clickState: Int64, clickGroup: Int64
  ) {
    let spi = PrivateSymbols.shared
    guard let setField = spi.setIntegerField, let setLocation = spi.setWindowLocation else {
      return
    }
    let opaque = Unmanaged.passUnretained(event).toOpaque()
    let windowNumber = Int64(windowId)
    setField(opaque, Field.gesturePhase, phase)
    setField(opaque, Field.clickState, clickState)
    setField(opaque, Field.buttonNumber, 0)
    setField(opaque, Field.subtype, 3)
    setField(opaque, Field.targetPID, Int64(pid))
    setField(opaque, Field.windowNumber, windowNumber)
    setField(opaque, Field.clickGroupID, clickGroup)
    setField(opaque, Field.windowUnderPointer, windowNumber)
    setField(opaque, Field.handlingWindowUnderPointer, windowNumber)
    setLocation(opaque, windowPoint.x, windowPoint.y)
  }

  /// Post `event` to `pid`. Chromium needs the SkyLight route (which goes through the activity
  /// monitor so the target accepts the event as live); the public `postToPid` preserves AppKit
  /// compatibility. `dualPost` posts through both, as the keyboard recipes do; a click must not,
  /// since Chromium then delivers each mouse-down and mouse-up twice.
  func post(_ event: CGEvent, to pid: pid_t, dualPost: Bool) {
    if let skyLight = PrivateSymbols.shared.postToPid {
      skyLight(pid, Unmanaged.passUnretained(event).toOpaque())
    }
    if dualPost || PrivateSymbols.shared.postToPid == nil {
      event.postToPid(pid)
    }
  }

  var markedEventsSupported: Bool { source != nil }

  /// A fresh click-group id (the nanosecond component of the monotonic clock), matching the
  /// upstream recipe; WindowServer does not publish field 58's accepted width.
  func newClickGroup() -> Int64 {
    Int64(DispatchTime.now().uptimeNanoseconds % 1_000_000_000)
  }
}
