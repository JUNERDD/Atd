import AICore
import ApplicationServices
import CoreGraphics

/// Selection presence checks on a single Accessibility text surface. Selections up to
/// ``maxVerifiedLength`` UTF-16 units verify that their text satisfies
/// ``TextCapture/hasContent(_:)`` without retaining it (preserving native token attachments whose
/// child cell exposes a readable value); larger or textless surfaces fall back to structural
/// non-text attachment and marker checks without copying large passages.
package nonisolated enum SelectionTextProbe {
  /// Maximum UTF-16 selection length materialized to verify readable content during a probe.
  private static let maxVerifiedLength = 4096

  package static func probe(_ element: AXUIElement, in app: AXUIElement) -> SelectionProbe? {
    probe(element, surface: SelectionSurface(element), in: app)
  }

  static func probe(
    _ element: AXUIElement, surface: SelectionSurface, in app: AXUIElement
  ) -> SelectionProbe? {
    AXUIElementSetMessagingTimeout(element, SelectionPresence.messagingTimeout)
    let subrole: String? = copy(element, kAXSubroleAttribute)
    if subrole == kAXSecureTextFieldSubrole { return .secureField }

    var emptyTextControlRange = false
    if surface.advertisesTextRange,
      let rangeValue: AXValue = copy(element, kAXSelectedTextRangeAttribute)
    {
      var range = CFRange()
      let valid = AXValueGetValue(rangeValue, .cfRange, &range) && range.location >= 0
      if valid, range.length > 0,
        withinCharacterCount(range, of: element, nativeText: surface.nativeText)
      {
        let bounds: AXValue? = copy(
          element, kAXBoundsForRangeParameterizedAttribute, rangeValue)
        let selectionRect = bounds.flatMap(rect)
        if !hasReadableRangeText(
          range, rangeValue: rangeValue, bounds: selectionRect, surface: surface,
          in: element, app: app)
        {
          return SelectionProbe.none
        }
        return .selected(length: range.length, bounds: selectionRect)
      }
      if valid, range.length == 0 {
        if surface.nativeText { return SelectionProbe.none }
        if surface.role.map(WriteTargetWritability.textRoles.contains) == true,
          withinCharacterCount(range, of: element, nativeText: false)
        {
          emptyTextControlRange = true
        }
      }
    }

    if surface.attributes.contains("AXSelectedTextMarkerRange"),
      let marker: CFTypeRef = copy(element, "AXSelectedTextMarkerRange"),
      let length: Int = copy(element, "AXLengthForTextMarkerRange", marker), length > 0
    {
      guard CFGetTypeID(marker) == AXTextMarkerRangeGetTypeID() else { return nil }
      let range = marker as! AXTextMarkerRange
      let start = AXTextMarkerRangeCopyStartMarker(range)
      let end = AXTextMarkerRangeCopyEndMarker(range)
      let collapsed = CFEqual(start, end)
      if collapsed
        || (emptyTextControlRange && markersStayWithin(start, end, container: element))
        || !hasReadableMarkerText(marker, length: length, start: start, end: end, in: element)
      {
        return SelectionProbe.none
      }
      let bounds: AXValue? = copy(element, "AXBoundsForTextMarkerRange", marker)
      return .selected(length: length, bounds: bounds.flatMap(rect))
    }
    return nil
  }

  private static func hasReadableMarkerText(
    _ marker: CFTypeRef, length: Int, start: AXTextMarker, end: AXTextMarker,
    in element: AXUIElement
  ) -> Bool {
    if length <= maxVerifiedLength,
      let text: String = copy(element, "AXStringForTextMarkerRange", marker), !text.isEmpty
    {
      return TextCapture.hasContent(text)
    }
    return length <= 4 ? !selectsNonTextObject(start, end, in: element) : true
  }

  private static func hasReadableRangeText(
    _ range: CFRange, rangeValue: AXValue, bounds: CGRect?, surface: SelectionSurface,
    in element: AXUIElement, app: AXUIElement
  ) -> Bool {
    if range.length <= maxVerifiedLength,
      let text = nonEmptySelectedText(
        of: element, rangeValue: rangeValue, nativeText: surface.nativeText)
    {
      if TextCapture.hasContent(text) { return true }
      if surface.nativeText,
        text.unicodeScalars.contains(where: { $0.value == 0xFFFC }),
        selectsReadableNativeAttachment(at: bounds, in: element, app: app)
      {
        return true
      }
      return false
    }
    if surface.nativeText, range.length == 1,
      selectsNativeAttachment(at: bounds, in: element, app: app)
    {
      return false
    }
    return true
  }

  /// Prefer `AXSelectedText`; only query `AXStringForRange` on native text controls because
  /// Chromium's `AXStringForRange` omits `U+FFFC` placeholders that `AXSelectedTextRange` counts.
  private static func nonEmptySelectedText(
    of element: AXUIElement, rangeValue: AXValue, nativeText: Bool
  ) -> String? {
    if let selected: String = copy(element, kAXSelectedTextAttribute), !selected.isEmpty {
      return selected
    }
    guard nativeText,
      let slice: String = copy(element, kAXStringForRangeParameterizedAttribute, rangeValue),
      !slice.isEmpty
    else { return nil }
    return slice
  }

  /// Unfocused WebKit text controls can answer an underflowed unsigned location on
  /// `AXSelectedTextRange` while their marker selection is empty; bound non-native ranges when
  /// the control reports its character count.
  private static func withinCharacterCount(
    _ range: CFRange, of element: AXUIElement, nativeText: Bool
  ) -> Bool {
    if nativeText { return true }
    guard let count: Int = copy(element, kAXNumberOfCharactersAttribute), count >= 0 else {
      return true
    }
    return range.length <= count && range.location <= count - range.length
  }

  /// Native token fields (`NSTokenField`) represent each token cell in the field editor as a
  /// `U+FFFC` character backed by a child non-image `AXTextAttachment` whose value carries the
  /// token's plain text. Inspect direct children by frame first (works even behind floating panels)
  /// before falling back to screen hit-testing when a field has many children.
  private static func selectsReadableNativeAttachment(
    at bounds: CGRect?, in element: AXUIElement, app: AXUIElement
  ) -> Bool {
    guard let bounds, bounds.width > 0, bounds.height > 0 else { return false }
    let deadline = ContinuousClock.now + .milliseconds(100)
    let targetRect = bounds.insetBy(
      dx: min(0.5, bounds.width * 0.25), dy: min(0.5, bounds.height * 0.25))
    var childCount: CFIndex = 0
    if AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &childCount)
      == .success, childCount > 0, childCount <= 64
    {
      var rawChildren: CFArray?
      if AXUIElementCopyAttributeValues(
        element, kAXChildrenAttribute as CFString, 0, childCount, &rawChildren) == .success,
        let children = rawChildren as? [AXUIElement]
      {
        for child in children where ContinuousClock.now < deadline {
          AXUIElementSetMessagingTimeout(child, SelectionPresence.messagingTimeout)
          guard let childRect = frame(of: child), childRect.intersects(targetRect) else { continue }
          if hasReadableAttachmentText(child, until: deadline) { return true }
        }
        return false
      }
    }
    let inset = min(4.0, bounds.width * 0.5)
    let xs =
      bounds.width > 12 ? [bounds.minX + inset, bounds.midX, bounds.maxX - inset] : [bounds.midX]
    return xs.contains { x in
      guard
        let hit = hitChild(
          x: Float(x), y: Float(bounds.midY), in: element, app: app, until: deadline)
      else { return false }
      return hasReadableAttachmentText(hit, until: deadline)
    }
  }

  private static func hasReadableAttachmentText(
    _ attachment: AXUIElement, until deadline: ContinuousClock.Instant
  ) -> Bool {
    guard (copy(attachment, kAXRoleAttribute) as String?) != kAXImageRole else { return false }
    if let value: String = copy(attachment, kAXValueAttribute), TextCapture.hasContent(value) {
      return true
    }
    return ContinuousClock.now < deadline
      && (copy(attachment, kAXTitleAttribute) as String?).map(TextCapture.hasContent) == true
  }

  /// Fallback when a native control exposes selection ranges and bounds without selected text:
  /// view-backed attachments hit a child `AXImage` or childless `AXGroup`.
  private static func selectsNativeAttachment(
    at bounds: CGRect?, in element: AXUIElement, app: AXUIElement
  ) -> Bool {
    guard let bounds, bounds.width > 0, bounds.height > 0 else { return false }
    let deadline = ContinuousClock.now + .milliseconds(100)
    guard
      let hit = hitChild(
        x: Float(bounds.midX), y: Float(bounds.midY), in: element, app: app, until: deadline)
    else { return false }
    return isNonTextLeaf(hit, until: deadline)
  }

  private static func hitChild(
    x: Float, y: Float, in element: AXUIElement, app: AXUIElement,
    until deadline: ContinuousClock.Instant
  ) -> AXUIElement? {
    var hit: AXUIElement?
    guard ContinuousClock.now < deadline,
      AXUIElementCopyElementAtPosition(app, x, y, &hit) == .success,
      let hit, !CFEqual(hit, element), ContinuousClock.now < deadline
    else { return nil }
    AXUIElementSetMessagingTimeout(hit, SelectionPresence.messagingTimeout)
    guard let parent: AXUIElement = copy(hit, kAXParentAttribute), CFEqual(parent, element) else {
      return nil
    }
    return hit
  }

  static func isNonTextLeaf(
    _ owner: AXUIElement, until deadline: ContinuousClock.Instant
  ) -> Bool {
    guard ContinuousClock.now < deadline else { return false }
    AXUIElementSetMessagingTimeout(owner, SelectionPresence.messagingTimeout)
    let role: String? = copy(owner, kAXRoleAttribute)
    guard role == kAXGroupRole || role == kAXImageRole, ContinuousClock.now < deadline else {
      return false
    }
    var count: CFIndex = 0
    let error = AXUIElementGetAttributeValueCount(owner, kAXChildrenAttribute as CFString, &count)
    return error == .success && count == 0
  }

  private static func frame(of element: AXUIElement) -> CGRect? {
    guard let posValue: AXValue = copy(element, kAXPositionAttribute),
      let sizeValue: AXValue = copy(element, kAXSizeAttribute)
    else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posValue, .cgPoint, &origin),
      AXValueGetValue(sizeValue, .cgSize, &size)
    else { return nil }
    return CGRect(origin: origin, size: size)
  }

  private static func rect(_ value: AXValue) -> CGRect? {
    var rect = CGRect.zero
    return AXValueGetValue(value, .cgRect, &rect) ? rect : nil
  }

  static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
      return nil
    }
    return value as? T
  }

  static func copy<T>(_ element: AXUIElement, _ attribute: String, _ parameter: CFTypeRef)
    -> T?
  {
    var value: CFTypeRef?
    let error = AXUIElementCopyParameterizedAttributeValue(
      element, attribute as CFString, parameter, &value)
    return error == .success ? value as? T : nil
  }
}
