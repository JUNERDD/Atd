import AICore
import Foundation
import Observation

/// Display state only. The shell supplies data and owns the effects of all row actions.
@Observable
final class TaskActivityModel {
  var items: [TaskActivityItem] = []
  var labels = TaskActivityLabels.current()
  var isOpen: Bool { popover.isOpen }
  var interactionAllowed = false
  var reducedMotion = false
  var below = true
  var entryAvailable = false
  var entryPressed = false
  var entryHovered = false
  var cardAvailable = false
  var cardOffset = CGSize.zero
  var cardWidth = TaskActivityMetrics.cardWidth
  var contentHeight = 120.0
  var contentViewport = 120.0
  var contentScrolls: Bool { contentHeight > contentViewport + 0.5 }
  var cardSize = CGSize(width: TaskActivityMetrics.cardWidth, height: 120)
  let entry = TaskActivityEntryPresence()
  let popover = MiniPanelPopoverState()
  var cardLane = CGRect.zero
  /// The request open on the card's own page, in place of the list.
  var page: TaskActivityPage?
  /// Tasks whose requests are spread out rather than stacked under the first.
  var expanded: Set<TaskActivityRunKey> = []
  /// Answers on their way, one per task; that task's decisions wait for the service to settle.
  var sending: [TaskActivityRunKey: TaskActivitySending] = [:]
  /// What the card says under a task's requests after an answer did not land.
  var notices: [TaskActivityRunKey: TaskActivityNotice] = [:]
  /// The task whose page the list returns from, until the list has brought it into view.
  var returning: TaskActivityReturn?
  /// A card the list hands the keyboard to; the card takes it and clears this.
  var focusedRow: TaskActivityRunKey?
  /// The page's latest answer was given with Return, so leaving it is a keyboard exit.
  @ObservationIgnored var pageAnsweredByKeyboard = false
  @ObservationIgnored var toggle: () -> Void = {}
  @ObservationIgnored var close: () -> Void = {}
  @ObservationIgnored var stop: (TaskActivityRunKey) -> Void = { _ in }
  @ObservationIgnored var open: (TaskActivityRunKey) -> Void = { _ in }
  @ObservationIgnored var monitor: (TaskActivityRunKey) -> Void = { _ in }
  @ObservationIgnored var answer: (TaskActivityRunKey, TaskActivityDecision) -> Void = { _, _ in }
  @ObservationIgnored var openView: (TaskActivityRunKey, TaskActivityPendingRequest) -> Void = {
    _, _ in
  }
  @ObservationIgnored var openPage: (TaskActivityRunKey, Int) -> Void = { _, _ in }
  /// Leaves the page for the list; `true` when the person left it with the keyboard.
  @ObservationIgnored var back: (Bool) -> Void = { _ in }
  @ObservationIgnored var setExpanded: (TaskActivityRunKey, Bool) -> Void = { _, _ in }

  var entryVisible: Bool { entry.visible }
  var entryInteractive: Bool { entry.interactive && interactionAllowed }
  var cardInteractive: Bool { popover.interactive && interactionAllowed }
  var entries: [TaskActivityListEntry] { TaskActivityListEntry.arrange(items) }
  /// What the card's height depends on: which headers and rows it lists, in order.
  var layoutKey: [TaskActivityListEntry.ID] { entries.map(\.id) }
  /// What the card's height depends on beyond its rows: the requests each row decides, how
  /// they are laid out, the open page and the notices under them.
  var contentLayout: TaskActivityLayoutKey {
    .init(
      rows: layoutKey, requests: items.map(\.requests), locked: items.map(\.locked),
      expanded: expanded, page: page, notices: notices)
  }
  /// The task and request on the card's page, while that task still waits on it.
  var pageContent: (item: TaskActivityItem, index: Int)? {
    guard let page, let item = items.first(where: { $0.key == page.key }),
      item.requests.indices.contains(page.index)
    else { return nil }
    return (item, page.index)
  }
  var taskCount: Int { Set(items.map { $0.key.taskID }).count }
  var executingCount: Int { items.filter { $0.phase.isExecuting }.count }
  var overviewSummary: String {
    let tasks = labels.tasks(taskCount)
    return executingCount > 0
      ? labels.format(.activityOverview, tasks, labels.count(.activityExecuting, executingCount))
      : tasks
  }
  var countSummary: String {
    labels.format(
      .activityCountSummary, labels.tasks(taskCount),
      labels.count(.activityExecuting, executingCount))
  }
  var needsAttention: Bool { items.contains { $0.needsAttention } }
  var hasWarning: Bool { items.contains { $0.hasWarning } }
  /// The entry's light, as the pill's: a run waiting for the person wins over running work.
  var glow: IslandGlowPalette? {
    guard entry.visible, !reducedMotion else { return nil }
    if items.contains(where: { $0.phase == .waiting }) { return .attention }
    return items.contains { $0.phase.isExecuting } ? .working : nil
  }

  func setEntryPressed(_ pressed: Bool) {
    if entryPressed != pressed { entryPressed = pressed }
  }
}

/// Everything besides the rows that sizes the card (``TaskActivityModel/contentLayout``).
struct TaskActivityLayoutKey: Equatable {
  let rows: [TaskActivityListEntry.ID]
  let requests: [[TaskActivityPendingRequest]]
  let locked: [Bool]
  let expanded: Set<TaskActivityRunKey>
  let page: TaskActivityPage?
  let notices: [TaskActivityRunKey: TaskActivityNotice]
}

/// A request at the revision the card showed: an answer to it, or its retirement, never
/// reaches a newer revision.
struct TaskActivityRequestRevision: Hashable {
  let id: String
  let revision: Int

  init(id: String, revision: Int) {
    self.id = id
    self.revision = revision
  }

  init(_ request: TaskActivityPendingRequest) {
    self.init(id: request.id, revision: request.revision)
  }
}

/// The list coming back from a task's request page: that task's card is brought into view and,
/// when the page was left with the keyboard, takes it.
struct TaskActivityReturn: Equatable {
  let key: TaskActivityRunKey
  let focus: Bool
}
