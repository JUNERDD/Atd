import ApplicationServices
import Foundation

/// Why an Accessibility message about a text field could not be answered.
nonisolated enum AXFieldError: Error, Equatable {
  /// The messaging timeout passed (`cannotComplete`): the app is busy or hung.
  case timedOut
  /// The element is gone (`invalidUIElement`), such as a closed window's field.
  case invalidElement
}

/// The Accessibility messages the write target's capture and `text.write` send to a text field.
/// A timed-out or vanished element throws; any other failure (an unsupported attribute, no
/// value) reads as nil or false.
///
/// Blocking; call it off the main thread, with messaging timeouts set on the elements.
nonisolated enum AXField {
  static func copy<T>(_ element: AXUIElement, _ attribute: String) throws(AXFieldError) -> T? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    try check(error)
    return error == .success ? value as? T : nil
  }

  /// `AXSelectedTextRange` in UTF-16 units; nil where the field has none, as web content, which
  /// uses text-marker ranges.
  static func selectedRange(of element: AXUIElement) throws(AXFieldError) -> CFRange? {
    guard let value: AXValue = try copy(element, kAXSelectedTextRangeAttribute) else { return nil }
    var range = CFRange()
    return AXValueGetValue(value, .cfRange, &range) ? range : nil
  }

  /// Sets `AXSelectedTextRange` when the field allows it; true when the field took it.
  static func setSelectedRange(_ range: CFRange, of element: AXUIElement) throws(AXFieldError)
    -> Bool
  {
    var settable: DarwinBoolean = false
    let attribute = kAXSelectedTextRangeAttribute as CFString
    try check(AXUIElementIsAttributeSettable(element, attribute, &settable))
    var range = range
    guard settable.boolValue, let value = AXValueCreate(.cfRange, &range) else { return false }
    let error = AXUIElementSetAttributeValue(element, attribute, value)
    try check(error)
    return error == .success
  }

  /// Makes the element its app's focused element unless it already is. Best effort: a field that
  /// refuses keeps whatever focus its app has.
  static func focus(_ element: AXUIElement, in app: AXUIElement) throws(AXFieldError) {
    let focused: AXUIElement? = try copy(app, kAXFocusedUIElementAttribute)
    if let focused, CFEqual(focused, element) { return }
    // The user may have moved to another window of the app since: bring the field's window back
    // first, so the paste lands in the recorded field rather than the current one.
    if let window: AXUIElement = try copy(element, kAXWindowAttribute) {
      try check(AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue))
      try check(AXUIElementPerformAction(window, kAXRaiseAction as CFString))
    }
    try check(
      AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue))
  }

  /// True for a password field, whose text must never be read or written.
  static func isSecure(_ element: AXUIElement) throws(AXFieldError) -> Bool {
    let subrole: String? = try copy(element, kAXSubroleAttribute)
    return subrole == kAXSecureTextFieldSubrole
  }

  /// `AXBoundsForRange`: where `range` is drawn, in Quartz points; nil where the field does not
  /// say.
  static func bounds(of range: CFRange, in element: AXUIElement) throws(AXFieldError) -> CGRect? {
    var range = range
    guard let parameter = AXValueCreate(.cfRange, &range),
      let value: AXValue = try copy(
        element, kAXBoundsForRangeParameterizedAttribute, parameter)
    else { return nil }
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  /// The caret's bounds from web content's text markers (`AXSelectedTextMarkerRange`, then
  /// `AXBoundsForTextMarkerRange`): a zero-width rect at the insertion point, in Quartz points.
  /// Chromium's editable content answers it only in complete accessibility, where
  /// `AXBoundsForRange` still fails for contenteditable; nil where the field has no markers.
  static func caretBounds(of element: AXUIElement) throws(AXFieldError) -> CGRect? {
    guard let selection: CFTypeRef = try copy(element, "AXSelectedTextMarkerRange"),
      let value: AXValue = try copy(element, "AXBoundsForTextMarkerRange", selection)
    else { return nil }
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  /// `AXLineForIndex`: the line holding the character at `index`.
  static func line(at index: Int, in element: AXUIElement) throws(AXFieldError) -> Int? {
    let line: NSNumber? = try copy(
      element, kAXLineForIndexParameterizedAttribute, index as CFNumber)
    return line?.intValue
  }

  /// `AXRangeForLine`: the characters of `line`, in UTF-16 units.
  static func range(ofLine line: Int, in element: AXUIElement) throws(AXFieldError) -> CFRange? {
    guard
      let value: AXValue = try copy(
        element, kAXRangeForLineParameterizedAttribute, line as CFNumber)
    else { return nil }
    var range = CFRange()
    return AXValueGetValue(value, .cfRange, &range) ? range : nil
  }

  /// The element's frame from `AXPosition` and `AXSize`, in Quartz points.
  static func frame(of element: AXUIElement) throws(AXFieldError) -> CGRect? {
    guard let position: AXValue = try copy(element, kAXPositionAttribute),
      let size: AXValue = try copy(element, kAXSizeAttribute)
    else { return nil }
    var origin = CGPoint.zero
    var extent = CGSize.zero
    guard AXValueGetValue(position, .cgPoint, &origin), AXValueGetValue(size, .cgSize, &extent)
    else { return nil }
    return CGRect(origin: origin, size: extent)
  }

  private static func copy<T>(_ element: AXUIElement, _ attribute: String, _ parameter: CFTypeRef)
    throws(AXFieldError) -> T?
  {
    var value: CFTypeRef?
    let error = AXUIElementCopyParameterizedAttributeValue(
      element, attribute as CFString, parameter, &value)
    try check(error)
    return error == .success ? value as? T : nil
  }

  private static func check(_ error: AXError) throws(AXFieldError) {
    switch error {
    case .cannotComplete: throw .timedOut
    case .invalidUIElement: throw .invalidElement
    default: break
    }
  }
}

extension CFRange {
  /// Same location and length; `CFRange` is not `Equatable`.
  nonisolated func matches(_ other: CFRange) -> Bool {
    location == other.location && length == other.length
  }
}
