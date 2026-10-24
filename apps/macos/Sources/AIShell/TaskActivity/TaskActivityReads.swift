import AICore
import Foundation

/// Ended runs the person has seen in the open card. Seeing an ended row is reading it, so it
/// leaves the list, but only once the card has closed and its departure has settled: the list
/// never changes under the reader, and a removal never restarts a closing card's motion.
@MainActor
final class TaskActivityReads {
  var onRead: (Set<TaskActivityRunKey>) -> Void = { _ in }
  private var seen: Set<TaskActivityRunKey> = []
  private var release: Task<Void, Never>?

  /// How long a closing card takes to leave, after which its content may change.
  static var departure: Double {
    MiniPanelChoreography.flyoutCloseDelay
      + max(
        MiniPanelMotion.settling(MiniPanelChoreography.labelLeave),
        MiniPanelMotion.settling(MiniPanelChoreography.flyoutClose))
  }

  /// While the card is open, every ended row it shows counts as read. Reopening before a
  /// pending release keeps those rows for this viewing as well.
  func shown(_ items: [TaskActivityItem]) {
    release?.cancel()
    release = nil
    seen.formUnion(items.filter(\.phase.isTerminal).map(\.key))
  }

  /// Runs read elsewhere while the card is open: they leave with the rows it showed.
  func read(_ keys: Set<TaskActivityRunKey>) {
    seen.formUnion(keys)
  }

  /// The card is closed (or hidden); release what it showed once it is gone.
  func closed() {
    guard !seen.isEmpty, release == nil else { return }
    release = Task { [weak self] in
      try? await Task.sleep(for: .seconds(Self.departure))
      guard let self, !Task.isCancelled else { return }
      let keys = seen
      seen = []
      release = nil
      onRead(keys)
    }
  }
}
