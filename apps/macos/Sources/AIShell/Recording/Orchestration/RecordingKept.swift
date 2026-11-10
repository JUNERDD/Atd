import AICore
import Foundation
import Synchronization

/// The last recording's result while it can still be shown again ("Show Last Recording"), asked
/// about, saved, copied or attached: until the next recording begins or the app quits
/// (architecture R7). Its take folder (the movie, the microphone's files and every export made
/// from it) goes with it, though not while an export or an import still reads it; the last
/// reader deletes the folder as it lets go.
nonisolated final class RecordingKept: Sendable {
  let result: RecordingResult
  /// What the result card shows; its `id` is the `sourceId` of every ask about it.
  let source: RecordingCardSource
  private struct State {
    var readers = 0
    var dropped = false
  }
  private let state = Mutex(State())

  init(_ result: RecordingResult, source: RecordingCardSource) {
    self.result = result
    self.source = source
  }

  /// Register before scheduling a reader. A discarded take cannot acquire new readers;
  /// every successful registration must be paired with ``letGo()``.
  func hold() -> Bool {
    state.withLock {
      guard !$0.dropped else { return false }
      $0.readers += 1
      return true
    }
  }

  /// The final reader deletes a dropped take before returning. The lock only decides
  /// ownership; filesystem work runs outside it on the reader's executor.
  func letGo() {
    let delete = state.withLock {
      precondition($0.readers > 0)
      $0.readers -= 1
      return $0.dropped && $0.readers == 0
    }
    if delete { Self.delete(result.take.folder) }
  }

  /// The result is no longer offered: its folder goes once nothing reads it.
  func drop() {
    let delete = state.withLock {
      guard !$0.dropped else { return false }
      $0.dropped = true
      return $0.readers == 0
    }
    if delete { Self.delete(result.take.folder) }
  }

  /// Deletes a take's folder in the temporary directory; one already gone is fine.
  static func delete(_ folder: URL) {
    try? FileManager.default.removeItem(at: folder)
  }
}
