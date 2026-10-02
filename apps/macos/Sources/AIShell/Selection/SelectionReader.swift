import AppKit
import ApplicationServices

/// Reads the selected text of the frontmost app through the Accessibility API (spike S8).
///
/// - Every AX message is bounded by a 250 ms messaging timeout, so an unresponsive app
///   cannot stall a summon (the AX default is about 6 s). A timeout aborts the whole read and
///   counts as no selection.
/// - The system-wide focused element comes first. It fails while an Electron app is
///   frontmost, so the read then starts from the frontmost app's pid.
/// - Per element: `AXSelectedText`, then `AXSelectedTextRange` + `AXStringForRange`, then
///   `AXValue` sliced by the range, then the text-marker range web content uses. Elements:
///   the focused one, its first 20 children, then up to 10 ancestors.
///
/// Blocking; call it off the main thread. Apps it cannot read are the S8 coverage gaps; there
/// is no fallback to a simulated Cmd+C.
nonisolated struct SelectionReader: Sendable {
  static let messagingTimeout: Float = 0.25

  /// The frontmost app, looked up on the main thread by the caller.
  let frontmostPID: pid_t?

  static var isTrusted: Bool { AXIsProcessTrusted() }

  /// Shows the system's Accessibility prompt when the app is not trusted yet.
  static func requestTrust() {
    // The value of `kAXTrustedCheckOptionPrompt`, a mutable global Swift 6 will not read.
    _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
  }

  func read() -> String? {
    var read = Read()
    let systemWide = AXUIElementCreateSystemWide()
    // On the system-wide element this sets the default for every AXUIElement of the process.
    AXUIElementSetMessagingTimeout(systemWide, Self.messagingTimeout)
    var focused: AXUIElement? = read.copy(systemWide, kAXFocusedUIElementAttribute)
    if focused == nil {
      // A failure here is the system-wide query, not a hung target.
      read.aborted = false
      guard let frontmostPID else { return nil }
      let app = AXUIElementCreateApplication(frontmostPID)
      AXUIElementSetMessagingTimeout(app, Self.messagingTimeout)
      focused = read.copy(app, kAXFocusedUIElementAttribute)
      if focused == nil, !read.aborted { focused = read.copy(app, kAXFocusedWindowAttribute) }
    }
    guard let focused, !read.aborted else { return nil }

    var candidates = [focused]
    if let children: [AXUIElement] = read.copy(focused, kAXChildrenAttribute) {
      candidates += children.prefix(20)
    }
    for element in candidates where !read.aborted {
      if let text = read.selection(of: element) { return text }
    }
    var current = focused
    for _ in 0..<10 where !read.aborted {
      guard let parent: AXUIElement = read.copy(current, kAXParentAttribute) else { break }
      if let text = read.selection(of: parent) { return text }
      current = parent
    }
    return nil
  }

  /// One read's AX calls; any `cannotComplete` marks the read aborted.
  private struct Read {
    var aborted = false

    mutating func selection(of element: AXUIElement) -> String? {
      if let text: String = copy(element, kAXSelectedTextAttribute), hasContent(text) {
        return text
      }
      if aborted { return nil }
      if let rangeValue: AXValue = copy(element, kAXSelectedTextRangeAttribute) {
        var range = CFRange()
        if AXValueGetValue(rangeValue, .cfRange, &range), range.length > 0 {
          if let text: String = copy(element, kAXStringForRangeParameterizedAttribute, rangeValue),
            hasContent(text)
          {
            return text
          }
          if aborted { return nil }
          if let value: String = copy(element, kAXValueAttribute) {
            let string = value as NSString
            if range.location >= 0, range.location + range.length <= string.length {
              let text = string.substring(
                with: NSRange(location: range.location, length: range.length))
              if hasContent(text) { return text }
            }
          }
        }
      }
      if aborted { return nil }
      // WebKit and Chromium expose web selections as text-marker ranges.
      if let marker: CFTypeRef = copy(element, "AXSelectedTextMarkerRange"),
        let text: String = copy(element, "AXStringForTextMarkerRange", marker), hasContent(text)
      {
        return text
      }
      return nil
    }

    mutating func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
      var value: CFTypeRef?
      let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
      return settle(error, value)
    }

    mutating func copy<T>(_ element: AXUIElement, _ attribute: String, _ parameter: CFTypeRef)
      -> T?
    {
      var value: CFTypeRef?
      let error = AXUIElementCopyParameterizedAttributeValue(
        element, attribute as CFString, parameter, &value)
      return settle(error, value)
    }

    private mutating func settle<T>(_ error: AXError, _ value: CFTypeRef?) -> T? {
      if error == .cannotComplete { aborted = true }
      return error == .success ? value as? T : nil
    }

    private func hasContent(_ text: String) -> Bool {
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }
}

extension SelectionReader {
  /// Reads off the main thread and gives up after `limit`, a net under the per-message
  /// timeout for apps that answer slowly but keep answering. A late read is discarded.
  static func readBounded(frontmostPID: pid_t?, limit: Duration = .milliseconds(750)) async
    -> String?
  {
    let reader = SelectionReader(frontmostPID: frontmostPID)
    return await Deadline.value(within: limit, fallback: nil) { reader.read() }
  }
}
