import AICore
import ApplicationServices
import CoreGraphics
import Foundation

extension ElementResolver {
  /// What Accessibility says about scrolling under a screenshot selection (`selection` and the
  /// area in Quartz points), for the long screenshot (decision D5): the selection's centre is
  /// hit-tested in the topmost app, and its ancestor chain walked up to the innermost scroll area
  /// that overlaps the selection by at least ``LongScreenshotGeometry/minimumBand`` both ways
  /// (``ElementChain/scrollEvidence(in:window:selection:minimumOverlap:)``). A found area comes
  /// back with its visible frame, cut to the window, and its vertical scroll bar's value.
  /// `.none` only when no window is there or the chain describes the selection without a scroll
  /// area; whatever Accessibility cannot tell is `.unknown`. Called once per settled selection,
  /// so its budgets are ``describe(at:frame:)``'s.
  ///
  /// AppKit apps answer well; Safari's main frame answers with a scroll area around its web
  /// area, its scroll bar value only partly (WebKit bug 292898); Chromium and Electron answer with
  /// the web contents' scroll area and no scroll bar value; scrolling `div`s are plain groups, so
  /// the page around them is offered. Apps that draw their own content answer with nothing
  /// under the window (WeChat implements no hit-test) or one element for all of it (Warp's text
  /// area), which tells nothing either way.
  func scrollArea(around selection: CGRect) async -> LongScreenshotScrollProbe {
    let point = CGPoint(x: selection.midX, y: selection.midY)
    let window: ElementChain.Window
    let hit: AXUIElement
    switch element(at: point) {
    case .noWindow: return .none
    case .silent: return .unknown
    case .element(let found, let element):
      window = found
      hit = element
    }
    var refinement = AccessibilityBudget(milliseconds: 100, calls: 96)
    let target = AccessibilityProbe.deepest(below: hit, at: point, budget: &refinement)
    var walk = AccessibilityBudget(milliseconds: 400, calls: 160)
    let elements = AccessibilityProbe.elements(from: target, budget: &walk)
    let evidence = ElementChain.scrollEvidence(
      in: elements.map(\.node), window: window, selection: selection,
      minimumOverlap: LongScreenshotGeometry.minimumBand)
    switch evidence {
    case .none: return .none
    case .unknown: return .unknown
    case .scrollArea(let index):
      let read = Self.frameAndVerticalValue(of: elements[index].element)
      let frame = (read.frame ?? elements[index].node.frame).intersection(window.frame)
      // The area moved out of the window between the walk and this read.
      guard !frame.isNull, !frame.isEmpty else { return .unknown }
      return .area(LongScreenshotScrollArea(frame: frame, verticalValue: read.value))
    }
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
