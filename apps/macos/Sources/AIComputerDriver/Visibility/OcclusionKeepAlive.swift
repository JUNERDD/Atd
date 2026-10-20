import AIComputerDriverKit
import CoreGraphics
import Foundation

/// Keeps a driven window "visible" from its own app's point of view while the agent works it in
/// the background, so Chromium/Electron/WebKit do not pause rendering and drop the web AX subtree.
/// It disables WindowServer occlusion notifications for the window — but only while the window is
/// still unoccluded, because the switch cannot un-hide an already-hidden window. Previous states
/// are restored on `release`, on driver exit, and via `atexit` as a last resort (plan §4.1; A3
/// conclusion 6). Adapted from open-computer-use `WindowOcclusionKeepAlive` (MIT).
final class OcclusionKeepAlive: @unchecked Sendable {
  static let shared = OcclusionKeepAlive()

  private let lock = NSLock()
  private var previousStates: [CGWindowID: Bool] = [:]
  private var exitHookInstalled = false

  /// Pin the window's visible state if it is currently unoccluded, and say what came of it. A
  /// window that is already covered cannot be pinned (`covered`); a refused switch latches the
  /// capability off for the process (`failed`).
  func keepVisible(windowId: CGWindowID, bounds: CGRect) -> DriverKeepAliveOutcome {
    guard PrivateSymbols.shared.capability(DriverCapabilityName.occlusionKeepAlive).available else {
      return .unavailable
    }
    lock.lock()
    defer { lock.unlock() }
    if previousStates[windowId] != nil { return .pinned }
    guard looksUnoccluded(windowId: windowId, bounds: bounds) else { return .covered }
    guard
      let previous = WindowServerQueries.setOcclusionNotificationsEnabled(false, windowId: windowId)
    else { return .failed }
    previousStates[windowId] = previous
    installExitHookIfNeeded()
    return .pinned
  }

  func isPinned(windowId: CGWindowID) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return previousStates[windowId] != nil
  }

  /// Restore one window's occlusion notifications to the state recorded when it was pinned.
  func release(windowId: CGWindowID) {
    lock.lock()
    defer { lock.unlock() }
    guard let previous = previousStates[windowId] else { return }
    if WindowServerQueries.setOcclusionNotificationsEnabled(previous, windowId: windowId) != nil {
      previousStates.removeValue(forKey: windowId)
    }
  }

  /// Restore every pinned window (connection/session end, driver exit).
  func releaseAll() {
    lock.lock()
    defer { lock.unlock() }
    for (windowId, previous) in previousStates {
      if WindowServerQueries.setOcclusionNotificationsEnabled(previous, windowId: windowId) != nil {
        previousStates.removeValue(forKey: windowId)
      }
    }
  }

  /// A window looks unoccluded when at least one point on a 16×16 grid over its bounds is not
  /// covered by any window above it in z-order. Mirrors Chromium's own manual occlusion check
  /// closely enough to decide whether freezing the visible state is safe.
  private func looksUnoccluded(windowId: CGWindowID, bounds: CGRect, grid: Int = 16) -> Bool {
    guard bounds.width > 0, bounds.height > 0 else { return false }
    var covering: [CGRect] = []
    for window in WindowList.onScreenWindows() {
      if window.windowId == windowId { break }  // front to back: stop at the target
      covering.append(window.bounds)
    }
    for row in 0..<grid {
      for column in 0..<grid {
        let point = CGPoint(
          x: bounds.minX + bounds.width * (CGFloat(column) + 0.5) / CGFloat(grid),
          y: bounds.minY + bounds.height * (CGFloat(row) + 0.5) / CGFloat(grid))
        if !covering.contains(where: { $0.contains(point) }) { return true }
      }
    }
    return false
  }

  private func installExitHookIfNeeded() {
    guard !exitHookInstalled else { return }
    exitHookInstalled = true
    atexit { OcclusionKeepAlive.shared.releaseAll() }
  }
}
