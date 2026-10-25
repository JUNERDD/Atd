import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Walks a window's AX tree into the flat `DriverElement` array the host reads. Uses a batch
/// `AXUIElementCopyMultipleAttributeValues` per node (one IPC round trip for six attributes),
/// bounds the walk to `maxElements` (default 600) and `maxDepth`, and drops pure layout
/// containers while reparenting their children to the nearest emitted ancestor. The batch-scan
/// shape follows open-computer-use's AccessibilitySnapshot (MIT); nothing is vendored.
enum AXSnapshotBuilder {
  static let defaultMaxElements = 600
  static let defaultMaxDepth = 24
  private static let valueLimit = 1000
  private static let scanAttributes = [
    kAXRoleAttribute as String, kAXSubroleAttribute as String, "AXIdentifier",
    kAXTitleAttribute as String, kAXDescriptionAttribute as String, kAXValueAttribute as String,
    kAXPositionAttribute as String, kAXSizeAttribute as String,
  ]
  private static let settableCandidates = [
    kAXValueAttribute as String, kAXFocusedAttribute as String, kAXSelectedTextAttribute as String,
  ]
  private static let layoutOnlyRoles: Set<String> = [
    "AXGroup", "AXLayoutArea", "AXLayoutItem", "AXSplitGroup", "AXUnknown",
  ]

  struct Result {
    var elements: [DriverElement]
    var refs: [(index: Int, element: AXUIElement)]
    var degradedReason: String?
  }

  static func build(window: AXUIElement, maxElements: Int, maxDepth: Int) -> Result {
    var elements: [DriverElement] = []
    var refs: [(index: Int, element: AXUIElement)] = []
    var truncated = false

    func visit(_ element: AXUIElement, depth: Int, emittedParent: Int?) {
      if elements.count >= maxElements {
        truncated = true
        return
      }
      let scan = batchScan(element)
      var parentForChildren = emittedParent
      if let role = scan.role, shouldEmit(role: role, scan: scan, element: element) {
        let index = elements.count
        elements.append(
          makeElement(index: index, parent: emittedParent, role: role, scan: scan, element: element)
        )
        refs.append((index, element))
        parentForChildren = index
      }
      guard depth < maxDepth else { return }
      for child in AXBindings.copyElements(element, kAXChildrenAttribute as String) {
        visit(child, depth: depth + 1, emittedParent: parentForChildren)
      }
    }

    visit(window, depth: 0, emittedParent: nil)
    let reason = degradedReason(elements: elements, truncated: truncated)
    return Result(elements: elements, refs: refs, degradedReason: reason)
  }

  private struct Scan {
    var role: String?
    var subrole: String?
    var identifier: String?
    var title: String?
    var description: String?
    var value: String?
    var valueTruncated: Bool
    var frame: CGRect?
  }

  private static func shouldEmit(role: String, scan: Scan, element: AXUIElement) -> Bool {
    if !layoutOnlyRoles.contains(role) { return true }
    if scan.title?.isEmpty == false || scan.description?.isEmpty == false { return true }
    if scan.value?.isEmpty == false { return true }
    return !AXBindings.actionNames(element).isEmpty
  }

  private static func makeElement(
    index: Int, parent: Int?, role: String, scan: Scan, element: AXUIElement
  ) -> DriverElement {
    let frame = scan.frame.map {
      DriverRect(x: $0.origin.x, y: $0.origin.y, width: $0.size.width, height: $0.size.height)
    }
    return DriverElement(
      index: index, parentIndex: parent, role: role, subrole: scan.subrole,
      identifier: scan.identifier, label: scan.title ?? scan.description, value: scan.value,
      valueTruncated: scan.valueTruncated,
      enabled: AXBindings.copyBool(element, kAXEnabledAttribute as String),
      focused: AXBindings.copyBool(element, kAXFocusedAttribute as String), frame: frame,
      actions: AXBindings.actionNames(element).map(stripAXPrefix),
      settableAttributes: AXBindings.settable(element, among: settableCandidates))
  }

  private static func batchScan(_ element: AXUIElement) -> Scan {
    var values: CFArray?
    let error = AXUIElementCopyMultipleAttributeValues(
      element, scanAttributes as CFArray, AXCopyMultipleAttributeOptions(), &values)
    let raw: [AnyObject]
    if error == .success, let array = values as? [AnyObject], array.count == scanAttributes.count {
      raw = array
    } else {
      raw = scanAttributes.map { attribute in
        var value: CFTypeRef?
        _ = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        return value ?? (NSNull() as AnyObject)
      }
    }
    func string(_ i: Int) -> String? {
      guard let text = raw[i] as? String, !text.isEmpty else { return nil }
      return text
    }
    let (value, valueTruncated) = clampedValue(raw[5])
    return Scan(
      role: string(0), subrole: string(1), identifier: string(2), title: string(3),
      description: string(4), value: value, valueTruncated: valueTruncated,
      frame: frame(position: raw[6], size: raw[7]))
  }

  private static func clampedValue(_ raw: AnyObject) -> (String?, Bool) {
    let text: String?
    if let string = raw as? String {
      text = string
    } else if CFGetTypeID(raw as CFTypeRef) == CFBooleanGetTypeID() {
      text = String(CFBooleanGetValue((raw as! CFBoolean)))
    } else if let number = raw as? NSNumber, !(raw is NSNull) {
      let double = number.doubleValue
      text = double.rounded() == double ? String(number.intValue) : String(double)
    } else {
      text = nil
    }
    guard let text, !text.isEmpty else { return (nil, false) }
    if text.count > valueLimit { return (String(text.prefix(valueLimit)), true) }
    return (text, false)
  }

  private static func frame(position: AnyObject, size: AnyObject) -> CGRect? {
    guard
      CFGetTypeID(position as CFTypeRef) == AXValueGetTypeID(),
      CFGetTypeID(size as CFTypeRef) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var extent = CGSize.zero
    guard
      AXValueGetValue((position as! AXValue), .cgPoint, &point),
      AXValueGetValue((size as! AXValue), .cgSize, &extent),
      point.x.isFinite, point.y.isFinite, extent.width >= 0, extent.height >= 0
    else { return nil }
    return CGRect(origin: point, size: extent)
  }

  private static func stripAXPrefix(_ action: String) -> String {
    action.hasPrefix("AX") ? String(action.dropFirst(2)) : action
  }

  private static func degradedReason(elements: [DriverElement], truncated: Bool) -> String? {
    if elements.isEmpty { return "axTreeEmpty" }
    if truncated { return "truncated" }
    return nil
  }
}
