import AICore
import ApplicationServices
import CoreGraphics
import Foundation

extension ElementResolver {
  /// The scroll area a screenshot selection lies over (`selection` and the answer in Quartz
  /// points), for the long screenshot (decision D5): the selection's centre is hit-tested in the
  /// topmost app, and its ancestor chain walked up to the innermost scroll area that overlaps
  /// the selection by at least ``LongScreenshotGeometry/minimumBand`` both ways
  /// (``ElementChain/scrollAreaIndex(in:window:selection:minimumOverlap:)``). Its visible frame,
  /// cut to the window, and its vertical scroll bar's value come back; nil without Accessibility,
  /// when nothing there scrolls, or when the app does not answer. Called once per settled
  /// selection, so its budgets are ``describe(at:frame:)``'s.
  ///
  /// AppKit apps answer well; Safari's main frame answers with a scroll area around its web
  /// area, its scroll bar value only partly (WebKit bug 292898); Chromium and Electron answer with
  /// the web contents' scroll area and no scroll bar value; scrolling `div`s are plain groups, so
  /// the page around them is offered.
  func scrollArea(around selection: CGRect) async -> LongScreenshotScrollArea? {
    let point = CGPoint(x: selection.midX, y: selection.midY)
    guard let found = element(at: point) else { return nil }
    let window = found.window
    var refinement = AccessibilityBudget(milliseconds: 100, calls: 96)
    let target = AccessibilityProbe.deepest(below: found.element, at: point, budget: &refinement)
    var walk = AccessibilityBudget(milliseconds: 400, calls: 160)
    let elements = AccessibilityProbe.elements(from: target, budget: &walk)
    guard
      let index = ElementChain.scrollAreaIndex(
        in: elements.map(\.node), window: window, selection: selection,
        minimumOverlap: LongScreenshotGeometry.minimumBand)
    else { return nil }
    let read = Self.frameAndVerticalValue(of: elements[index].element)
    let frame = (read.frame ?? elements[index].node.frame).intersection(window.frame)
    guard !frame.isNull, !frame.isEmpty else { return nil }
    return LongScreenshotScrollArea(frame: frame, verticalValue: read.value)
  }

  /// A scroll area's `AXFrame` and its `AXVerticalScrollBar` in one round trip, then the bar's
  /// `AXValue` (0 at the top, 1 at the end), clamped; either nil when the app has none.
  private nonisolated static func frameAndVerticalValue(of area: AXUIElement)
    -> (frame: CGRect?, value: Double?)
  {
    let names = ["AXFrame", kAXVerticalScrollBarAttribute] as CFArray
    var values: CFArray?
    guard
      AXUIElementCopyMultipleAttributeValues(
        area, names, AXCopyMultipleAttributeOptions(), &values) == .success,
      let values = values as? [CFTypeRef], values.count == 2
    else { return (nil, nil) }
    // A failed attribute comes back as an `AXValue` of type error, not as an absent entry.
    var frame: CGRect?
    if CFGetTypeID(values[0]) == AXValueGetTypeID() {
      var rect = CGRect.zero
      if AXValueGetValue(unsafeDowncast(values[0], to: AXValue.self), .cgRect, &rect) {
        frame = rect
      }
    }
    guard CFGetTypeID(values[1]) == AXUIElementGetTypeID() else { return (frame, nil) }
    let bar = unsafeDowncast(values[1], to: AXUIElement.self)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(bar, kAXValueAttribute as CFString, &value) == .success,
      let number = value as? NSNumber, number.doubleValue.isFinite
    else { return (frame, nil) }
    return (frame, min(max(number.doubleValue, 0), 1))
  }
}
