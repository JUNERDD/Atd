import AICore
import ApplicationServices
import Foundation

/// Selection capabilities of the focused surface, shared by presence, reading and write-back.
/// Attribute advertisement matters: custom canvases can answer a fabricated zero text range
/// even though they do not implement text selection. No application identifier is consulted.
nonisolated struct SelectionSurface {
  let element: AXUIElement
  let role: String?
  let attributes: Set<String>

  init(_ element: AXUIElement) {
    self.element = element
    AXUIElementSetMessagingTimeout(element, SelectionPresence.messagingTimeout)
    role = Self.value(element, kAXRoleAttribute) as? String
    var names: CFArray?
    let result = AXUIElementCopyAttributeNames(element, &names)
    attributes = result == .success ? Set(names as? [String] ?? []) : []
  }

  var advertisesTextRange: Bool { attributes.contains(kAXSelectedTextRangeAttribute) }

  var nativeText: Bool {
    role.map(WriteTargetWritability.textRoles.contains) == true && advertisesTextRange
      && attributes.isDisjoint(with: Self.webAttributes)
  }

  /// A container with no usable selection protocol can be a custom document canvas. Its menu
  /// supplies only an unmeasured selection hint; an explicit action must still copy real text.
  /// Lists, outlines, images and controls are deliberately outside this fallback.
  var opaqueEditor: Bool {
    [kAXGroupRole, kAXSplitGroupRole, "AXLayoutArea"].contains(role ?? "")
      && !advertisesTextRange
      && attributes.isDisjoint(with: Self.structuredAttributes.union(Self.webAttributes))
  }

  /// The nearest cell-based table that actually reports selected cells. A text editor inside
  /// a cell owns its text selection and must never inherit the surrounding grid selection.
  /// Row-based file lists are not cell selections. This checks counts, never cell values.
  func selectedCellContainer() -> AXUIElement? {
    if role.map(WriteTargetWritability.textRoles.contains) == true { return nil }
    let deadline = ContinuousClock.now + .milliseconds(150)
    var current = self
    for _ in 0..<6 {
      guard ContinuousClock.now < deadline else { return nil }
      if current.attributes.contains("AXSelectedCells") {
        var count: CFIndex = 0
        if AXUIElementGetAttributeValueCount(
          current.element, "AXSelectedCells" as CFString, &count) == .success, count > 0
        {
          return current.element
        }
        return nil
      }
      if current.role == kAXWindowRole || current.role == kAXApplicationRole { return nil }
      guard let parent = Self.value(current.element, kAXParentAttribute),
        CFGetTypeID(parent) == AXUIElementGetTypeID()
      else { return nil }
      current = SelectionSurface(parent as! AXUIElement)
    }
    return nil
  }

  private static let structuredAttributes: Set<String> = [
    "AXSelectedCells", kAXSelectedChildrenAttribute, kAXSelectedRowsAttribute,
    kAXSelectedColumnsAttribute,
  ]
  private static let webAttributes: Set<String> = [
    "AXSelectedTextMarkerRange", "AXStartTextMarker", "AXDOMIdentifier", "AXDOMClassList",
  ]

  private static func value(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
      return nil
    }
    return value
  }
}

/// The cell identities present at summon time, without their contents. Replacing a changed
/// region is refused. Very large selections remain readable, but do not get an unverifiable
/// write target. This also avoids materializing an entire worksheet's accessibility tree.
nonisolated struct CellSelection: @unchecked Sendable {
  let table: AXUIElement
  let cells: [AXUIElement]

  init?(_ table: AXUIElement) {
    self.table = table
    guard let cells = Self.read(table) else { return nil }
    self.cells = cells
  }

  func isCurrent() -> Bool {
    guard let current = Self.read(table), current.count == cells.count else { return false }
    return zip(current, cells).allSatisfy { CFEqual($0, $1) }
  }

  private static func read(_ table: AXUIElement) -> [AXUIElement]? {
    AXUIElementSetMessagingTimeout(table, SelectionPresence.messagingTimeout)
    var count: CFIndex = 0
    let name = "AXSelectedCells" as CFString
    guard AXUIElementGetAttributeValueCount(table, name, &count) == .success,
      count > 0, count <= 256
    else { return nil }
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(table, name, 0, count, &values) == .success,
      let cells = values as? [AXUIElement], cells.count == count
    else { return nil }
    return cells
  }
}
