import AICore
import AppKit
import ApplicationServices

/// Reads the selected text of the frontmost app through the Accessibility API (spike S8).
///
/// - Every AX message is bounded by a 250 ms messaging timeout, so an unresponsive app
///   cannot stall a summon (the AX default is about 6 s). A timeout aborts the whole read and
///   counts as no selection.
/// - Focus is resolved inside the caller's frontmost external app. A nonactivating Atd panel
///   can own system-wide keyboard focus while that external app remains frontmost.
/// - Per element: `AXSelectedText`, then `AXSelectedTextRange` + `AXStringForRange`, then
///   `AXValue` sliced by the range, then the text-marker range web content uses. Elements:
///   the focused one, its first 20 children, then up to 10 ancestors.
///
/// Without text, the read reports what the focused element showed (``SelectionFocus``): a
/// password field, a native text element with an empty selection, an app that did not answer,
/// or nothing it can tell from. Apps it cannot read are the S8 coverage gaps; where the summon
/// reads the selection, ``CopySelection`` covers them with a simulated ⌘C when that is
/// ``SelectionFocus/unknown``. The panel's live `selection.read` stays Accessibility only.
///
/// Blocking; call it off the main thread.
nonisolated struct SelectionReader: Sendable {
  /// A read's answer: the selected text, or what the focus showed without one.
  enum Outcome: Sendable {
    case text(String)
    case none(SelectionFocus)

    var text: String? {
      if case .text(let text) = self { text } else { nil }
    }
  }

  /// Attributes only web content (WebKit, Chromium) lists, whose selection Accessibility may not
  /// show: a page can draw one of its own.
  private static let webAttributes: Set<String> = [
    "AXSelectedTextMarkerRange", "AXStartTextMarker", "AXDOMIdentifier", "AXDOMClassList",
  ]

  static let messagingTimeout: Float = 0.25

  /// The frontmost app, looked up on the main thread by the caller.
  let frontmostPID: pid_t?

  static var isTrusted: Bool { AXIsProcessTrusted() }

  /// Shows the system's Accessibility prompt when the app is not trusted yet.
  static func requestTrust() {
    // The value of `kAXTrustedCheckOptionPrompt`, a mutable global Swift 6 will not read.
    _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
  }

  func read() -> Outcome {
    guard let frontmostPID, frontmostPID != ProcessInfo.processInfo.processIdentifier else {
      return .none(.unknown)
    }
    var read = Read()
    let systemWide = AXUIElementCreateSystemWide()
    // On the system-wide element this sets the default for every AXUIElement of the process.
    AXUIElementSetMessagingTimeout(systemWide, Self.messagingTimeout)
    // A system-wide focus query can synchronously reenter our AppKit window on this worker
    // before it even returns an AX handle. Resolve the external process before any AX read.
    let app = AXUIElementCreateApplication(frontmostPID)
    AXUIElementSetMessagingTimeout(app, Self.messagingTimeout)
    var focused: AXUIElement? = read.copy(app, kAXFocusedUIElementAttribute)
    if focused == nil, !read.aborted { focused = read.copy(app, kAXFocusedWindowAttribute) }
    guard let focused, !read.aborted else { return .none(read.aborted ? .unresponsive : .unknown) }
    if read.isSecure(focused) { return .none(.secureField) }
    // Copy preserves the app's row/column serialization. Never substitute the active cell's
    // value or a surrounding text view for an entire selected region.
    if SelectionSurface(focused).selectedCellContainer() != nil { return .none(.unknown) }

    if let text = read.search(focused) { return .text(text) }
    guard !read.aborted else { return .none(.unresponsive) }
    let focus = read.focus(of: focused)
    return .none(read.aborted ? .unresponsive : focus)
  }

  /// One read's AX calls; any `cannotComplete` marks the read aborted.
  private struct Read {
    private enum ElementSelection {
      case text(String)
      case empty
      case none
    }

    var aborted = false

    mutating func search(_ focused: AXUIElement) -> String? {
      var candidates = [focused]
      if let children: [AXUIElement] = copy(focused, kAXChildrenAttribute) {
        candidates += children.prefix(20)
      }
      for element in candidates where !aborted {
        switch selection(of: element) {
        case .text(let text): return text
        case .empty: return nil
        case .none: continue
        }
      }
      var current = focused
      for _ in 0..<10 where !aborted {
        guard let parent: AXUIElement = copy(current, kAXParentAttribute) else { break }
        switch selection(of: parent) {
        case .text(let text): return text
        case .empty: return nil
        case .none: current = parent
        }
      }
      return nil
    }

    private mutating func selection(of element: AXUIElement) -> ElementSelection {
      if let text: String = copy(element, kAXSelectedTextAttribute), !text.isEmpty {
        return hasContent(text) ? .text(text) : .none
      }
      if aborted { return .none }
      var selectedRange: (value: AXValue, range: CFRange)?
      var emptyTextControlRange = false
      if let rangeValue: AXValue = copy(element, kAXSelectedTextRangeAttribute) {
        var range = CFRange()
        if AXValueGetValue(rangeValue, .cfRange, &range), range.location >= 0 {
          if range.length == 0, advertisesEmptyTextControlRange(of: element, at: range.location) {
            emptyTextControlRange = true
          } else if range.length > 0 {
            selectedRange = (rangeValue, range)
          }
        }
      }
      if aborted { return .none }
      // WebKit and Chromium expose web selections as text-marker ranges. Check them before
      // AXStringForRange because Chromium's AXStringForRange omits U+FFFC placeholders.
      if let marker: CFTypeRef = copy(element, "AXSelectedTextMarkerRange"),
        let text: String = copy(element, "AXStringForTextMarkerRange", marker), !text.isEmpty
      {
        guard hasContent(text) else { return .none }
        if emptyTextControlRange, SelectionTextProbe.markersStayWithin(marker, container: element) {
          return .empty
        }
        return .text(text)
      }
      if aborted { return .none }
      if let (rangeValue, range) = selectedRange {
        if let text: String = copy(element, kAXStringForRangeParameterizedAttribute, rangeValue),
          !text.isEmpty
        {
          return hasContent(text) ? .text(text) : .none
        }
        if aborted { return .none }
        if let value: String = copy(element, kAXValueAttribute) {
          let string = value as NSString
          if range.length <= string.length, range.location <= string.length - range.length {
            let slice = string.substring(
              with: NSRange(location: range.location, length: range.length))
            if !slice.isEmpty { return hasContent(slice) ? .text(slice) : .none }
          }
        }
      }
      return .none
    }

    private mutating func advertisesEmptyTextControlRange(
      of element: AXUIElement, at location: Int
    ) -> Bool {
      guard let role: String = copy(element, kAXRoleAttribute),
        WriteTargetWritability.textRoles.contains(role)
      else { return false }
      var names: CFArray?
      let error = AXUIElementCopyAttributeNames(element, &names)
      if error == .cannotComplete { aborted = true }
      guard error == .success, let names = names as? [String],
        names.contains(kAXSelectedTextRangeAttribute)
      else { return false }
      if let count: Int = copy(element, kAXNumberOfCharactersAttribute), count >= 0 {
        return location <= count
      }
      return true
    }

    mutating func isSecure(_ element: AXUIElement) -> Bool {
      let subrole: String? = copy(element, kAXSubroleAttribute)
      return subrole == kAXSecureTextFieldSubrole
    }

    /// What `element`, the focus, shows when no selected text was found: an empty native
    /// selection only for a native text role with an empty range that advertises its selected
    /// range and lists none of the web content attributes. Custom editors such as WPS answer an
    /// unadvertised empty range on their container even while text is selected; that is still
    /// unknown.
    mutating func focus(of element: AXUIElement) -> SelectionFocus {
      guard let role: String = copy(element, kAXRoleAttribute),
        WriteTargetWritability.textRoles.contains(role),
        let value: AXValue = copy(element, kAXSelectedTextRangeAttribute)
      else {
        return .unknown
      }
      var range = CFRange()
      guard AXValueGetValue(value, .cfRange, &range), range.length == 0 else { return .unknown }
      var names: CFArray?
      let error = AXUIElementCopyAttributeNames(element, &names)
      if error == .cannotComplete { aborted = true }
      guard error == .success, let names = names as? [String],
        names.contains(kAXSelectedTextRangeAttribute)
      else { return .unknown }
      return names.contains(where: SelectionReader.webAttributes.contains)
        ? .unknown : .emptyNativeText
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
      TextCapture.hasContent(text)
    }
  }
}

extension SelectionReader {
  /// Reads off the main thread and gives up after `limit`, a net under the per-message
  /// timeout for apps that answer slowly but keep answering. A late read is discarded.
  static func readBounded(frontmostPID: pid_t?, limit: Duration = .milliseconds(750)) async
    -> Outcome
  {
    let reader = SelectionReader(frontmostPID: frontmostPID)
    return await Deadline.value(within: limit, fallback: .none(.unresponsive)) { reader.read() }
  }
}
