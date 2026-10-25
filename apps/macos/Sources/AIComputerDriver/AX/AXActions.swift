import AIComputerDriverKit
import ApplicationServices
import Foundation

/// Semantic AX actions and attribute writes: the unconditionally imperceptible rung. These never
/// open a visible menu (`AXShowMenu`) or raise a window (`AXRaise`) — those are excluded from the
/// background path by invariant (plan I3). Actions that can spin a nested run loop on the target
/// (press/pick/showAlternateUI) are invoked here synchronously; the caller runs them on an
/// abandonable worker so a stuck call does not wedge the executor.
enum AXActions {
  private static func actionName(_ action: DriverAXActionKind) -> String {
    switch action {
    case .press: return kAXPressAction as String
    case .pick: return kAXPickAction as String
    case .confirm: return kAXConfirmAction as String
    case .increment: return kAXIncrementAction as String
    case .decrement: return kAXDecrementAction as String
    case .showAlternateUI: return "AXShowAlternateUI"
    }
  }

  /// Perform one AX action on an element. Throws `noRoute` when the element does not advertise the
  /// action or the target rejects it. `kAXErrorFailure` is NOT treated as a rejection: many AppKit
  /// controls return it for a press that actually fired in the background (verified directly — a
  /// bare `AXUIElementPerformAction(AXPress)` returns -25200 on every call while the control's
  /// action fires every time). Only a genuinely unusable action (`actionUnsupported`,
  /// `cannotComplete`, an invalid element, …) is a `noRoute` refusal; the host still verifies the
  /// intended state by re-reading before reporting `verified`.
  static func perform(_ element: AXUIElement, _ action: DriverAXActionKind) throws {
    let name = actionName(action)
    let error = AXUIElementPerformAction(element, name as CFString)
    guard dispatched(error) else {
      throw DriverFailure(
        code: .noRoute, message: "AX action \(name) failed (AXError \(error.rawValue))")
    }
  }

  /// Whether an `AXUIElementPerformAction` return means the action was dispatched: success, or
  /// `kAXErrorFailure` (the ambiguous code AppKit controls return on a successful background press).
  static func dispatched(_ error: AXError) -> Bool { error == .success || error == .failure }

  /// Set an element's `AXValue` to a string (used for `setValue`/`clear`). Throws
  /// `textUnavailable` when the attribute is not settable or the write is rejected.
  static func setValue(_ element: AXUIElement, _ value: String) throws {
    guard isSettable(element, kAXValueAttribute as String) else {
      throw DriverFailure(
        code: .textUnavailable, message: "AXValue is not settable on this element")
    }
    let error = AXUIElementSetAttributeValue(
      element, kAXValueAttribute as CFString, value as CFString)
    guard error == .success else {
      throw DriverFailure(
        code: .textUnavailable, message: "AXValue write failed (AXError \(error.rawValue))")
    }
  }

  /// Make an element the app's focused element. Throws `noRoute` when `AXFocused` is not settable.
  static func focus(_ element: AXUIElement) throws {
    guard isSettable(element, kAXFocusedAttribute as String) else {
      throw DriverFailure(code: .noRoute, message: "AXFocused is not settable on this element")
    }
    let error = AXUIElementSetAttributeValue(
      element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    guard error == .success else {
      throw DriverFailure(
        code: .noRoute, message: "AXFocused write failed (AXError \(error.rawValue))")
    }
  }

  static func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var flag = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, attribute as CFString, &flag) == .success
      && flag.boolValue
  }
}
