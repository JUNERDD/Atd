import ApplicationServices
import CoreGraphics
import Foundation

/// Thin, synchronous wrappers over the HIServices AX C API. Every read sets a messaging timeout
/// so an unresponsive target returns `kAXErrorCannotComplete` instead of blocking forever (plan
/// §4.1; A2 conclusion 18). These run only on a target's serial executor thread, never the
/// driver's main read loop.
enum AXBindings {
  /// Per-read messaging timeout. Reads are inline with this bound; actions that can open UI run
  /// on an abandonable worker instead (see `TargetExecutors`).
  static let readTimeout: Float = 0.25

  static func application(pid: pid_t) -> AXUIElement {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, readTimeout)
    return app
  }

  static func copyValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
      return nil
    }
    return value
  }

  static func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
    copyValue(element, attribute) as? String
  }

  static func copyBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
    guard let value = copyValue(element, attribute) else { return nil }
    guard CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return CFBooleanGetValue((value as! CFBoolean))
  }

  static func copyElements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
    copyValue(element, attribute) as? [AXUIElement] ?? []
  }

  static func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    guard let value = copyValue(element, attribute) else { return nil }
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
  }

  /// A value as text: strings pass through (clamped by the caller), numbers and booleans are
  /// stringified so sliders, steppers and checkboxes read as text.
  static func valueText(_ element: AXUIElement, _ attribute: String) -> String? {
    guard let value = copyValue(element, attribute) else { return nil }
    if let text = value as? String { return text }
    if CFGetTypeID(value) == CFBooleanGetTypeID() {
      return String(CFBooleanGetValue((value as! CFBoolean)))
    }
    if let number = value as? NSNumber {
      let double = number.doubleValue
      return double.rounded() == double ? String(number.intValue) : String(double)
    }
    return nil
  }

  /// The element's frame in global top-left screen points, from `AXPosition` + `AXSize`.
  static func frame(_ element: AXUIElement) -> CGRect? {
    guard
      let positionValue = copyValue(element, kAXPositionAttribute as String),
      let sizeValue = copyValue(element, kAXSizeAttribute as String),
      CFGetTypeID(positionValue) == AXValueGetTypeID(),
      CFGetTypeID(sizeValue) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard
      AXValueGetValue((positionValue as! AXValue), .cgPoint, &point),
      AXValueGetValue((sizeValue as! AXValue), .cgSize, &size),
      point.x.isFinite, point.y.isFinite, size.width >= 0, size.height >= 0
    else { return nil }
    return CGRect(origin: point, size: size)
  }

  static func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return names as? [String] ?? []
  }

  /// Which of `attributes` the element reports as settable right now.
  static func settable(_ element: AXUIElement, among attributes: [String]) -> [String] {
    attributes.filter { attribute in
      var flag = DarwinBoolean(false)
      let error = AXUIElementIsAttributeSettable(element, attribute as CFString, &flag)
      return error == .success && flag.boolValue
    }
  }

  static func childCount(_ element: AXUIElement, _ attribute: String) -> Int {
    var count: CFIndex = 0
    guard AXUIElementGetAttributeValueCount(element, attribute as CFString, &count) == .success
    else { return 0 }
    return count
  }
}
