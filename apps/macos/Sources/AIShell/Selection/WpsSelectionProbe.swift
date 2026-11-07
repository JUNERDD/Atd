import AICore
import ApplicationServices
import Foundation
import Synchronization

/// WPS's sheet canvas does not expose its cells. The add-in proves changed cell selections;
/// Accessibility proves selected text in the separate formula editor, including in-cell editing.
nonisolated enum WpsSelectionProbe {
  private struct Editor: @unchecked Sendable {
    // Only immutable AX handles are shared; selection ranges are read afresh for each gesture.
    let window: AXUIElement
    let title: String
    let field: AXUIElement
    let expires: ContinuousClock.Instant
  }
  private static let cached = Mutex<Editor?>(nil)

  /// nil means another WPS component/document, which keeps the existing native path.
  static func probe(app: AXUIElement, evidence: WpsSelectionEvidence) -> SelectionProbe? {
    let window: AXUIElement? = value(app, kAXFocusedWindowAttribute)
    let title: String? = window.flatMap { value($0, kAXTitleAttribute) }
    let matched = title == evidence.windowTitle
    guard let window, let title else { return SelectionProbe.none }
    guard matched else { return nil }
    if let field = editor(window: window, title: title),
      let raw: AXValue = value(field, kAXSelectedTextRangeAttribute)
    {
      var range = CFRange()
      let valid = AXValueGetValue(raw, .cfRange, &range)
      if valid, range.length > 0 {
        return .selected(length: range.length, bounds: nil)
      }
    }
    return evidence.cells ? .cells : SelectionProbe.none
  }

  private static func editor(window: AXUIElement, title: String) -> AXUIElement? {
    if let cache = cached.withLock({ $0 }), cache.title == title,
      CFEqual(cache.window, window), .now < cache.expires
    {
      return cache.field
    }
    let deadline = ContinuousClock.now + .milliseconds(60)
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var cursor = 0
    var fields: [AXUIElement] = []
    var complete = true
    var omitted = 0
    while cursor < queue.count, ContinuousClock.now < deadline {
      let (node, depth) = queue[cursor]
      cursor += 1
      let role: String? = value(node, kAXRoleAttribute)
      if role == nil { complete = false }
      if role == kAXTextAreaRole { fields.append(node) }
      var count = 0
      let status = AXUIElementGetAttributeValueCount(node, kAXChildrenAttribute as CFString, &count)
      if status == .attributeUnsupported || status == .noValue { continue }
      guard status == .success else {
        complete = false
        continue
      }
      guard count > 0 else { continue }
      let limit = depth < 5 ? min(count, 120 - queue.count) : 0
      omitted += count - limit
      guard limit > 0 else { continue }
      var raw: CFArray?
      if AXUIElementCopyAttributeValues(
        node, kAXChildrenAttribute as CFString, 0, limit, &raw)
        == .success, let children = raw as? [AXUIElement]
      {
        if children.count != limit { complete = false }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
      } else {
        complete = false
      }
    }
    // Never choose an arbitrary editor in an ambiguous or incomplete tree.
    complete = complete && cursor == queue.count && omitted == 0
    let field = complete && fields.count == 1 ? fields.first : nil
    cached.withLock {
      $0 = field.map {
        Editor(window: window, title: title, field: $0, expires: .now + .seconds(5))
      }
    }
    return field
  }

  private static func value<T>(_ element: AXUIElement, _ name: String) -> T? {
    AXUIElementSetMessagingTimeout(element, 0.02)
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &raw) == .success else {
      cached.withLock { $0 = nil }
      return nil
    }
    return raw as? T
  }
}
