import ApplicationServices

nonisolated extension SelectionTextProbe {
  /// Whether both endpoints of `marker` resolve inside `container` rather than elsewhere in the
  /// page (for example, DOM rows selected while a hidden helper `<textarea>` keeps keyboard focus).
  static func markersStayWithin(_ marker: CFTypeRef, container: AXUIElement) -> Bool {
    guard CFGetTypeID(marker) == AXTextMarkerRangeGetTypeID() else { return false }
    let range = marker as! AXTextMarkerRange
    return markersStayWithin(
      AXTextMarkerRangeCopyStartMarker(range), AXTextMarkerRangeCopyEndMarker(range),
      container: container)
  }

  static func markersStayWithin(
    _ start: AXTextMarker, _ end: AXTextMarker, container: AXUIElement
  ) -> Bool {
    let deadline = ContinuousClock.now + .milliseconds(100)
    guard let first: CFTypeRef = copy(container, "AXUIElementForTextMarker", start),
      CFGetTypeID(first) == AXUIElementGetTypeID(), ContinuousClock.now < deadline,
      let last: CFTypeRef = copy(container, "AXUIElementForTextMarker", end),
      CFGetTypeID(last) == AXUIElementGetTypeID()
    else { return false }
    return isWithin(first as! AXUIElement, container: container, until: deadline)
      && isWithin(last as! AXUIElement, container: container, until: deadline)
  }

  private static func isWithin(
    _ node: AXUIElement, container: AXUIElement, until deadline: ContinuousClock.Instant
  ) -> Bool {
    var current = node
    for _ in 0..<32 where ContinuousClock.now < deadline {
      if CFEqual(current, container) { return true }
      AXUIElementSetMessagingTimeout(current, SelectionPresence.messagingTimeout)
      let role: String? = copy(current, kAXRoleAttribute)
      if role == "AXWebArea" || role == kAXWindowRole || role == kAXApplicationRole {
        return false
      }
      guard let parent: AXUIElement = copy(current, kAXParentAttribute) else { return false }
      current = parent
    }
    return false
  }

  /// Fallback when a web host exposes marker lengths without `AXStringForTextMarkerRange`:
  /// inline images and void objects span a non-text leaf with no text between the markers.
  static func selectsNonTextObject(
    _ start: AXTextMarker, _ end: AXTextMarker, in element: AXUIElement
  ) -> Bool {
    let deadline = ContinuousClock.now + .milliseconds(100)
    guard let first: CFTypeRef = copy(element, "AXUIElementForTextMarker", start),
      CFGetTypeID(first) == AXUIElementGetTypeID(), ContinuousClock.now < deadline,
      let last: CFTypeRef = copy(element, "AXUIElementForTextMarker", end),
      CFGetTypeID(last) == AXUIElementGetTypeID()
    else { return false }
    let firstElement = first as! AXUIElement
    let lastElement = last as! AXUIElement
    let firstNonText = isNonTextLeaf(firstElement, until: deadline)
    let lastNonText =
      CFEqual(firstElement, lastElement)
      ? firstNonText : isNonTextLeaf(lastElement, until: deadline)
    guard firstNonText || lastNonText else { return false }

    let nextStart: CFTypeRef? =
      ContinuousClock.now < deadline ? copy(element, "AXNextTextMarkerForTextMarker", start) : nil
    let prevEnd: CFTypeRef? =
      ContinuousClock.now < deadline
      ? copy(element, "AXPreviousTextMarkerForTextMarker", end) : nil

    if ContinuousClock.now < deadline,
      let startIndex: Int = copy(element, "AXIndexForTextMarker", start), startIndex >= 0,
      let endIndex: Int = copy(element, "AXIndexForTextMarker", end), startIndex == endIndex
    {
      if lastNonText,
        ownsAdjacentMarker(prevEnd, leaf: lastElement, anchor: start, in: element, until: deadline)
      {
        return true
      }
      if firstNonText,
        ownsAdjacentMarker(nextStart, leaf: firstElement, anchor: end, in: element, until: deadline)
      {
        return true
      }
    }

    if ContinuousClock.now < deadline,
      let nextEnd: CFTypeRef = copy(element, "AXNextTextMarkerForTextMarker", end),
      sameTextPosition(nextStart, nextEnd, in: element, until: deadline),
      (markerGap(end, nextEnd, in: element, until: deadline) ?? 0) > 0
    {
      return true
    }
    if ContinuousClock.now < deadline,
      let prevStart: CFTypeRef = copy(element, "AXPreviousTextMarkerForTextMarker", start),
      sameTextPosition(prevStart, prevEnd, in: element, until: deadline),
      (markerGap(start, prevStart, in: element, until: deadline) ?? 0) > 0
    {
      return true
    }
    return false
  }

  private static func ownsAdjacentMarker(
    _ marker: CFTypeRef?, leaf: AXUIElement, anchor: AXTextMarker, in element: AXUIElement,
    until deadline: ContinuousClock.Instant
  ) -> Bool {
    guard let marker, CFGetTypeID(marker) == AXTextMarkerGetTypeID(),
      ContinuousClock.now < deadline,
      let owner: CFTypeRef = copy(element, "AXUIElementForTextMarker", marker),
      CFGetTypeID(owner) == AXUIElementGetTypeID(), CFEqual(owner, leaf)
    else { return false }
    return markerGap(anchor, marker, in: element, until: deadline) == 0
  }

  private static func sameTextPosition(
    _ first: CFTypeRef?, _ last: CFTypeRef?, in element: AXUIElement,
    until deadline: ContinuousClock.Instant
  ) -> Bool {
    guard sameMarkerOwner(first, last, in: element, until: deadline), let first, let last else {
      return false
    }
    return markerGap(first, last, in: element, until: deadline) == 0
  }

  private static func sameMarkerOwner(
    _ first: CFTypeRef?, _ last: CFTypeRef?, in element: AXUIElement,
    until deadline: ContinuousClock.Instant
  ) -> Bool {
    guard let first, let last,
      CFGetTypeID(first) == AXTextMarkerGetTypeID(), CFGetTypeID(last) == AXTextMarkerGetTypeID(),
      ContinuousClock.now < deadline,
      let firstOwner: CFTypeRef = copy(element, "AXUIElementForTextMarker", first),
      CFGetTypeID(firstOwner) == AXUIElementGetTypeID(), ContinuousClock.now < deadline,
      let lastOwner: CFTypeRef = copy(element, "AXUIElementForTextMarker", last),
      CFGetTypeID(lastOwner) == AXUIElementGetTypeID()
    else { return false }
    return CFEqual(firstOwner, lastOwner)
  }

  private static func markerGap(
    _ first: CFTypeRef, _ last: CFTypeRef, in element: AXUIElement,
    until deadline: ContinuousClock.Instant
  ) -> Int? {
    if CFEqual(first, last) { return 0 }
    guard ContinuousClock.now < deadline,
      let gap: CFTypeRef = copy(
        element, "AXTextMarkerRangeForUnorderedTextMarkers", [first, last] as CFArray),
      CFGetTypeID(gap) == AXTextMarkerRangeGetTypeID(), ContinuousClock.now < deadline
    else { return nil }
    return copy(element, "AXLengthForTextMarkerRange", gap)
  }
}
