import AppKit
import CoreGraphics
import Foundation

/// One on-screen or off-screen window as the public `CGWindowList` reports it. Used for route
/// gating (does the target still exist, is it owned by the target pid) and the z-order
/// disturbance check (did the target rise above the user's windows).
struct WindowFacts: Equatable {
  let windowId: CGWindowID
  let ownerPID: pid_t
  let bounds: CGRect
  let isOnScreen: Bool
  let layer: Int
}

enum WindowList {
  /// All windows, front to back, including off-screen ones (`.optionAll`). `.optionAll` is
  /// required: `.optionOnScreenOnly` omits a window that is minimized, on another Space, or in a
  /// hidden app, all of which are valid snapshot/capture targets.
  static func allWindows() -> [WindowFacts] {
    let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    return info.compactMap(parse)
  }

  /// On-screen windows only, front to back (z-order). Used to decide whether the target sits
  /// above the user's windows after a write.
  static func onScreenWindows() -> [WindowFacts] {
    let info =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    return info.compactMap(parse)
  }

  /// The facts for one window, or nil when it no longer exists.
  static func window(_ windowId: CGWindowID) -> WindowFacts? {
    allWindows().first { $0.windowId == windowId }
  }

  /// Whether `windowId` still exists and is owned by `pid`. A write target that fails this is
  /// gone and the primitive is refused `targetGone`.
  static func windowMatches(_ windowId: CGWindowID, pid: pid_t) -> Bool {
    allWindows().contains { $0.windowId == windowId && $0.ownerPID == pid }
  }

  /// Whether the app owning `pid` is hidden (its windows cannot become key, so keys would drop).
  static func appIsHidden(pid: pid_t) -> Bool {
    NSRunningApplication(processIdentifier: pid)?.isHidden == true
  }

  private static func parse(_ info: [String: Any]) -> WindowFacts? {
    guard
      let number = info[kCGWindowNumber as String] as? NSNumber,
      let ownerPID = info[kCGWindowOwnerPID as String] as? NSNumber,
      let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
      let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
    else { return nil }
    let onScreen = (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false
    let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
    return WindowFacts(
      windowId: number.uint32Value, ownerPID: ownerPID.int32Value, bounds: bounds,
      isOnScreen: onScreen, layer: layer)
  }
}
