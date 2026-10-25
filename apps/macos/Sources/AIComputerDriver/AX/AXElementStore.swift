import ApplicationServices
import Foundation

/// Holds a live `AXUIElement` so it can cross a serial-executor boundary. AX element references
/// are CF types and not `Sendable`; they are only ever dereferenced on the owning target's
/// executor thread, so the box is `@unchecked Sendable` by construction.
final class AXElementRef: @unchecked Sendable {
  let element: AXUIElement
  init(_ element: AXUIElement) { self.element = element }
}

/// Maps snapshot element tokens (`<snapshotId>.e<index>`) back to live `AXUIElement`s, and
/// invalidates them by snapshot generation: a new snapshot of the same window supersedes the old
/// one, so tokens from the previous read stop resolving (and a `perform` on them fails
/// `staleElement`). One store per driver; guarded by a lock because snapshots and performs run on
/// different per-pid executors.
final class AXElementStore: @unchecked Sendable {
  private let lock = NSLock()
  private var counter = 0
  private var currentSnapshot: [CGWindowID: String] = [:]
  private var maps: [String: [Int: AXElementRef]] = [:]

  /// Record a fresh snapshot's elements and return its generation id. Drops the window's previous
  /// generation so its tokens no longer resolve.
  func register(windowId: CGWindowID, elements: [(index: Int, element: AXUIElement)]) -> String {
    lock.lock()
    defer { lock.unlock() }
    if let previous = currentSnapshot[windowId] {
      maps.removeValue(forKey: previous)
    }
    counter += 1
    let snapshotId = "w\(windowId)s\(counter)"
    var map: [Int: AXElementRef] = [:]
    map.reserveCapacity(elements.count)
    for entry in elements {
      map[entry.index] = AXElementRef(entry.element)
    }
    maps[snapshotId] = map
    currentSnapshot[windowId] = snapshotId
    return snapshotId
  }

  /// Resolve a `<snapshotId>.e<index>` token to its element, or nil when the generation was
  /// invalidated or the token is malformed.
  func element(forToken token: String) -> AXUIElement? {
    guard let range = token.range(of: ".e", options: .backwards) else { return nil }
    let snapshotId = String(token[token.startIndex..<range.lowerBound])
    guard let index = Int(token[range.upperBound...]) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    return maps[snapshotId]?[index]?.element
  }

  /// Forget every generation for a window (used when its process or window is gone).
  func invalidate(windowId: CGWindowID) {
    lock.lock()
    defer { lock.unlock() }
    if let snapshotId = currentSnapshot.removeValue(forKey: windowId) {
      maps.removeValue(forKey: snapshotId)
    }
  }
}
