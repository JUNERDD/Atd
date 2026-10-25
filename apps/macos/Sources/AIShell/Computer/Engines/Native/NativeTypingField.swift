import AICore
import ApplicationServices
import Foundation

/// Read-only correspondence between a driver target and its AX field. Input still goes through
/// the driver; these reads only decide whether it is safe to split it and where to draw its trace.
nonisolated struct NativeTypingField: Sendable {
  struct State: Equatable, Sendable {
    let value: String
    let location: Int
    let length: Int
  }

  let target: WriteTarget
  let frame: CGRect
  let windowFrame: CGRect
  let windowId: Int
  private let requiresFocus: Bool

  static func find(pid: pid_t, windowId: Int, expected: CGRect?, role: String?) -> Self? {
    let deadline = ContinuousClock.now + .milliseconds(200)
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.05)
    guard let windowFrame = NativeSurfaceProbe.frame(windowId: windowId, pid: pid),
      let windows: [AXUIElement] = try? AXField.copy(app, kAXWindowsAttribute)
    else { return nil }
    var matching: [AXUIElement] = []
    for window in windows {
      guard ContinuousClock.now < deadline else { return nil }
      AXUIElementSetMessagingTimeout(window, 0.05)
      if (try? AXField.frame(of: window)) == windowFrame { matching.append(window) }
    }
    guard matching.count == 1, let window = matching.first else { return nil }
    var fields: [AXUIElement] = []
    if let expected {
      var queue = [window]
      var visited = 0
      while let element = queue.popLast(), visited < 300, ContinuousClock.now < deadline {
        visited += 1
        AXUIElementSetMessagingTimeout(element, 0.05)
        let foundRole: String? = try? AXField.copy(element, kAXRoleAttribute)
        if foundRole == role, (try? AXField.frame(of: element)) == expected {
          fields.append(element)
        }
        let children: [AXUIElement] = (try? AXField.copy(element, kAXChildrenAttribute)) ?? []
        queue.append(contentsOf: children)
      }
      // A truncated search cannot establish uniqueness.
      guard queue.isEmpty, ContinuousClock.now < deadline else { return nil }
    } else if let focused: AXUIElement = try? AXField.copy(app, kAXFocusedUIElementAttribute),
      let owner: AXUIElement = try? AXField.copy(focused, kAXWindowAttribute),
      CFEqual(owner, window)
    {
      fields = [focused]
    }
    guard fields.count == 1, let field = fields.first,
      let fieldRole: String = try? AXField.copy(field, kAXRoleAttribute),
      NativeObservation.textInputRoles.contains(fieldRole), (try? AXField.isSecure(field)) == false,
      let frame = try? AXField.frame(of: field), windowFrame.contains(frame),
      let range = try? AXField.selectedRange(of: field)
    else { return nil }
    return Self(
      target: WriteTarget(
        pid: pid, element: field, selection: .field(range: range), selectedText: nil),
      frame: frame, windowFrame: windowFrame, windowId: windowId, requiresFocus: expected == nil)
  }

  func state() -> State? {
    // A window-addressed type call follows focus. Do not continue into a different field.
    if requiresFocus {
      let app = AXUIElementCreateApplication(target.pid)
      AXUIElementSetMessagingTimeout(app, 0.05)
      guard let focused: AXUIElement = try? AXField.copy(app, kAXFocusedUIElementAttribute),
        CFEqual(focused, target.element)
      else { return nil }
    }
    AXUIElementSetMessagingTimeout(target.element, 0.05)
    guard NativeSurfaceProbe.frame(windowId: windowId, pid: target.pid) == windowFrame,
      (try? AXField.frame(of: target.element)) == frame,
      (try? AXField.isSecure(target.element)) == false,
      let value: String = try? AXField.copy(target.element, kAXValueAttribute),
      let range = try? AXField.selectedRange(of: target.element),
      range.location >= 0, range.length >= 0, range.location + range.length <= value.utf16.count
    else { return nil }
    return State(value: value, location: range.location, length: range.length)
  }
}
