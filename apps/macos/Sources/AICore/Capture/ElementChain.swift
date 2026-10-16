import CoreGraphics
import Foundation

/// The pure half of element detection: which window is under a point, and which frames of an
/// Accessibility ancestor chain make useful capture areas. The Accessibility calls themselves
/// live in `AIShell`; this type only sees roles and frames, all in Quartz points (global,
/// origin at the top-left of the primary display, y down).
public enum ElementChain {
  /// Frames with a shorter side are noise (separators, hairlines) rather than something a
  /// person would pick.
  public static let minimumSide: CGFloat = 5
  /// Stacked groups that report the same frame are one candidate; "the same" allows this much
  /// rounding between parent and child.
  public static let duplicateTolerance: CGFloat = 1
  /// How far an Accessibility window may differ from its `CGWindowList` bounds and still be
  /// taken as the same window (shadows and rounding differ between the two sources).
  public static let windowTolerance: CGFloat = 2
  /// Roles that never make a capture area: the app root, the menu bar and unclassified nodes
  /// answer with frames that span far more than what the pointer is over.
  public static let deniedRoles: Set<String> = ["AXApplication", "AXMenuBar", "AXUnknown"]

  /// A window of the session's z-order snapshot.
  public struct Window: Equatable, Sendable {
    public var id: UInt32
    public var pid: Int32
    public var frame: CGRect

    public init(id: UInt32, pid: Int32, frame: CGRect) {
      self.id = id
      self.pid = pid
      self.frame = frame
    }
  }

  /// One element of an Accessibility ancestor chain.
  public struct Node: Equatable, Sendable {
    public var role: String
    public var frame: CGRect

    public init(role: String, frame: CGRect) {
      self.role = role
      self.frame = frame
    }
  }

  /// The frontmost window containing `point`. `windows` is front to back, so the first match
  /// wins; unusable frames (non-finite or tiny) are skipped, never matched.
  public static func topmostWindow(at point: CGPoint, in windows: [Window]) -> Window? {
    windows.first { isUsable($0.frame) && $0.frame.contains(point) }
  }

  /// The area `window` offers at `point`, cut to the displays it shows on.
  ///
  /// `separateSpaces` is the system's "Displays have separate Spaces" setting (on by default).
  /// With it, macOS draws a window on one display only and leaves its overhang on the others
  /// undrawn, so the window is cut to the display under the point. Without it, the window is cut
  /// to every display it is on (the bounds of its parts), so a window spanning displays is
  /// offered whole, as a capture can span them, while a part off every screen is dropped. A
  /// display that only touches the window's edge holds no part of it. Nil when nothing usable
  /// remains.
  public static func windowArea(
    at point: CGPoint, window: Window, displays: [CGRect], separateSpaces: Bool
  ) -> CGRect? {
    guard isUsable(window.frame) else { return nil }
    let shown = separateSpaces ? displays.filter { $0.contains(point) }.prefix(1) : displays[...]
    let parts = shown.map { $0.intersection(window.frame) }.filter { $0.width > 0 && $0.height > 0 }
    let area = parts.isEmpty ? window.frame : parts.reduce(CGRect.null) { $0.union($1) }
    return isUsable(area) && area.contains(point) ? area : nil
  }

  /// The candidate areas at `point` inside `window`, smallest first and ending with the window
  /// area; empty when the window offers no area there.
  ///
  /// `chain` is the Accessibility ancestor chain from the deepest element under the point up to
  /// and including its window; nil when Accessibility is unavailable or failed, which leaves
  /// the window alone. The chain only counts when it reaches a window or sheet whose frame
  /// matches `window`: otherwise the hit belongs to some other surface (a stale or foreign
  /// tree) and would highlight areas that are not under the pointer. `displays` and
  /// `separateSpaces` decide the window area (``windowArea(at:window:displays:separateSpaces:)``).
  public static func targets(
    at point: CGPoint, window: Window, displays: [CGRect], separateSpaces: Bool, chain: [Node]?
  ) -> [CGRect] {
    guard
      let area = windowArea(
        at: point, window: window, displays: displays, separateSpaces: separateSpaces)
    else { return [] }
    guard let chain, let boundary = verifiedBoundary(of: chain, in: window) else { return [area] }

    let inside =
      chain[..<boundary]
      .filter { !deniedRoles.contains($0.role) && isUsable($0.frame) }
      .map { $0.frame.intersection(area) }
      .filter { isUsable($0) && $0.contains(point) }
    // A scroll view's content is larger than the view around it, so the chain is not
    // monotonic; order by size instead. The sort is stable, so equal sizes keep chain order.
    let ordered = inside.enumerated()
      .sorted { lhs, rhs in
        let (a, b) = (
          lhs.element.width * lhs.element.height, rhs.element.width * rhs.element.height
        )
        return a == b ? lhs.offset < rhs.offset : a < b
      }
      .map(\.element)

    var result: [CGRect] = []
    for frame in ordered where !nearlyEqual(frame, result.last, duplicateTolerance) {
      result.append(frame)
    }
    // The window area is exact; a candidate that only approximates it is the same area.
    while let last = result.last, nearlyEqual(last, area, duplicateTolerance) {
      result.removeLast()
    }
    return result + [area]
  }

  /// The positions in `chain` of the elements that offered `frame` as a candidate at `point`
  /// (``targets(at:window:displays:separateSpaces:chain:)`` with the same arguments), deepest
  /// first. Stacked elements can share one candidate, so there may be several; the caller picks
  /// the one that describes best. Empty when `frame` is the window area (a window is not an
  /// element) or no element offered it.
  public static func elementIndices(
    offering frame: CGRect, at point: CGPoint, window: Window, displays: [CGRect],
    separateSpaces: Bool, chain: [Node]
  ) -> [Int] {
    guard
      let area = windowArea(
        at: point, window: window, displays: displays, separateSpaces: separateSpaces),
      !nearlyEqual(frame, area, duplicateTolerance),
      let boundary = verifiedBoundary(of: chain, in: window)
    else { return [] }
    return chain[..<boundary].indices.filter { index in
      let node = chain[index]
      guard !deniedRoles.contains(node.role), isUsable(node.frame) else { return false }
      let candidate = node.frame.intersection(area)
      return isUsable(candidate) && candidate.contains(point)
        && nearlyEqual(candidate, frame, duplicateTolerance)
    }
  }

  /// Index of the first window or sheet in `chain` that is `window` itself. Anything beyond it
  /// is outside the window and ignored.
  private static func verifiedBoundary(of chain: [Node], in window: Window) -> Int? {
    chain.firstIndex {
      ($0.role == "AXWindow" || $0.role == "AXSheet")
        && nearlyEqual($0.frame, window.frame, windowTolerance)
    }
  }

  private static func isUsable(_ frame: CGRect) -> Bool {
    let values = [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height]
    return values.allSatisfy(\.isFinite) && min(frame.width, frame.height) >= minimumSide
  }

  private static func nearlyEqual(_ a: CGRect, _ b: CGRect?, _ tolerance: CGFloat) -> Bool {
    guard let b else { return false }
    let deltas = [a.minX - b.minX, a.minY - b.minY, a.maxX - b.maxX, a.maxY - b.maxY]
    return deltas.allSatisfy { abs($0) <= tolerance }
  }
}
