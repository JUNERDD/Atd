import AICore
import ApplicationServices

/// Asks Accessibility whether a write target's focused element can take text, for the rule in
/// ``WriteTargetWritability``: its `AXEditableAncestor` first, then its role, then whether its
/// value and its selected text can be set, stopping at the first answer that leaves it writable. Each message
/// is bounded by the messaging timeout set on the element; a timeout, like any other error,
/// counts as no answer and ends the questions, so a busy app costs at most one more timeout and
/// reads as writable.
///
/// Blocking; call it off the main thread.
nonisolated enum AXWritability {
  /// WebKit's and Chromium's: the nearest editable element that contains the focus.
  private static let editableAncestor = "AXEditableAncestor"

  static func writable(_ element: AXUIElement) -> Bool {
    let ancestor = editableAncestor(of: element)
    guard !WriteTargetWritability.decided(by: ancestor) else { return true }
    let role = role(of: element)
    guard !WriteTargetWritability.decided(by: role) else { return true }
    let value = settable(kAXValueAttribute, of: element)
    guard !WriteTargetWritability.decided(by: value) else { return true }
    let selectedText = settable(kAXSelectedTextAttribute, of: element)
    return WriteTargetWritability.writable(
      ancestor: ancestor, role: role, value: value, selectedText: selectedText)
  }

  /// The element's `AXRole`; nil when it did not say.
  private static func role(of element: AXUIElement) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success
    else { return nil }
    return value as? String
  }

  private static func editableAncestor(of element: AXUIElement)
    -> WriteTargetWritability.Ancestor
  {
    var value: CFTypeRef?
    switch AXUIElementCopyAttributeValue(element, editableAncestor as CFString, &value) {
    case .success: return value == nil ? .absent : .present
    case .noValue, .attributeUnsupported: return .absent
    default: return .unknown
    }
  }

  private static func settable(_ attribute: String, of element: AXUIElement)
    -> WriteTargetWritability.Settable
  {
    var settable: DarwinBoolean = false
    switch AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) {
    case .success: return settable.boolValue ? .settable : .notSettable
    case .attributeUnsupported: return .unsupported
    default: return .unknown
    }
  }
}
