import AICore
import AIRelay
import Foundation
import OSLog

/// Joins service-owned activity with this host's authorized preview sources. Neither the
/// renderer's current conversation nor the visibility of a window owns these runs.
final class ShellTaskActivity {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "task-activity")
  private weak var shell: ShellController?
  private let presentation: TaskActivityController
  private var snapshot: TaskActivitySnapshotWire?
  private var current = false
  private var stops: [TaskActivityRunKey: StopState] = [:]
  /// Runs taken out of the list: those the person stopped from it, which leave at once and stay
  /// out once stopped (only an unconfirmed stop brings one back, to be stopped again), and ended
  /// runs the person has read, in the card or in their conversation in the panel.
  private var dismissed: Set<TaskActivityRunKey> = []

  private enum StopState { case requested, unconfirmed }

  init(shell: ShellController) {
    self.shell = shell
    presentation = TaskActivityController(panel: shell.miniPanel)
    presentation.onStop = { [weak self] key in self?.stop(key) }
    presentation.onOpen = { [weak self] key in self?.open(key) }
    presentation.onMonitor = { [weak self] key in self?.monitor(key) }
    presentation.onAnswer = { [weak self] key, decision in self?.answer(decision, for: key) }
    presentation.onOpenView = { [weak self] key, request in self?.openView(request, of: key) }
    presentation.reads.onRead = { [weak self] keys in
      guard let self else { return }
      dismissed.formUnion(keys)
      refresh()
    }
  }

  func receive(_ next: TaskActivitySnapshotWire) {
    if let snapshot, snapshot.serviceId == next.serviceId, snapshot.epoch == next.epoch {
      guard next.revision >= snapshot.revision else { return }
    } else {
      stops.removeAll()
      dismissed.removeAll()
    }
    snapshot = next
    current = true
    let active = Set(next.runs.filter { !$0.status.isTerminal }.map(Self.key))
    stops = stops.filter { active.contains($0.key) }
    dismissed.formIntersection(next.runs.map(Self.key))
    // A run that ends while its conversation is on screen ends in front of the person.
    readShownConversation(refreshing: false)
    refresh()
  }

  /// The panel, on screen, shows a conversation: its ended runs are read there. The panel reports
  /// what it shows (`task.shown`), so opening a conversation, the panel returning to one, and a
  /// run ending while it is shown all count. A card on screen keeps them until it has gone.
  func readShownConversation(refreshing: Bool = true) {
    guard let shell, shell.panel.isVisible, let taskId = shell.shownComputerTaskId,
      let snapshot
    else { return }
    let ended = Set(
      snapshot.runs.filter { $0.taskId == taskId && $0.status.isTerminal }.map(Self.key)
    )
    .subtracting(dismissed)
    guard !ended.isEmpty else { return }
    if presentation.cardShown {
      // The card is open, or still leaving after opening this very conversation.
      presentation.reads.read(ended)
      if !presentation.isOpen { presentation.reads.closed() }
      return
    }
    dismissed.formUnion(ended)
    if refreshing { refresh() }
  }

  /// Even a successful reconnect waits for its full snapshot before showing live progress.
  func connectionChanged() {
    current = false
    refresh()
  }

  func refresh() {
    guard let shell else { return }
    let items: [TaskActivityItem] =
      snapshot?.runs.compactMap { run in
        let key = Self.key(run)
        let lifecycle = phase(run)
        guard !dismissed.contains(key) || lifecycle == .stopPending else { return nil }
        return TaskActivityPresentation.item(
          run, phase: lifecycle,
          canShowPreview: current && shell.control.state == .connected
            && shell.computer.previews.contains(taskId: key.taskID, runId: key.runID),
          hostLocked: current && snapshot?.hostState == .locked)
      } ?? []
    // The service's root-task counts: a task waiting for the person wins over running work.
    let status = current && shell.control.state == .connected ? shell.control.status : nil
    presentation.update(
      items: items,
      ongoingWork: (status?.attention ?? 0) > 0
        ? .attention : (status?.running ?? 0) > 0 ? .working : nil)
  }

  private func phase(_ run: TaskActivityRunWire) -> TaskActivityPhase {
    switch run.status {
    case .completed: return .completed
    case .stopped, .cancelled: return .stopped
    case .failed, .interrupted, .unknown: return .failed
    default: break
    }
    if stops[Self.key(run)] == .unconfirmed { return .stopPending }
    if stops[Self.key(run)] == .requested { return .stopping }
    guard current else { return .disconnected }
    if run.status == .stopping { return .stopping }
    if !run.requests.isEmpty || run.status == .awaitingInput
      || run.status == .awaitingConfirmation
    {
      return .waiting
    }
    // The computer host's state concerns only runs that operate the computer.
    guard run.computer != nil else { return .running }
    if snapshot?.hostState == .unavailable { return .disconnected }
    if snapshot?.hostState == .locked { return .waiting }
    return .running
  }

  private func open(_ key: TaskActivityRunKey) {
    guard contains(key), let shell else { return }
    presentation.close()
    shell.openNotifiedTask(key.taskID)
  }

  private func monitor(_ key: TaskActivityRunKey) {
    guard contains(key), current, let shell, shell.control.state == .connected else { return }
    // A source can disappear between pointer-down and click. Refresh the disabled state;
    // never fall through to a different run's sources.
    guard shell.computer.previews.show(taskId: key.taskID, runId: key.runID) else {
      return refresh()
    }
    presentation.close()
  }

  /// Answers a request from the card. An Always allow saves the command's allowlist entry
  /// first and allows this call only once it is saved. The service's next snapshot settles the
  /// row; an answer the service refuses because the request was settled or replaced meanwhile
  /// (gone, or at a newer revision) shows the task's next request, and any other failure keeps
  /// the request pending under an inline error.
  private func answer(_ decision: TaskActivityDecision, for key: TaskActivityRunKey) {
    let request = TaskActivityRequestRevision(id: decision.requestID, revision: decision.revision)
    guard let shell, let snapshot,
      snapshot.runs.contains(where: {
        Self.key($0) == key && $0.requests.contains { Self.revision($0) == request }
      })
    else { return presentation.answerFailed(key, request: request, notice: .stale) }
    Task { [weak self] in
      let notice: TaskActivityNotice
      do {
        let client = try await shell.services.client()
        guard client.endpoint.serviceId == snapshot.serviceId,
          client.endpoint.epoch == snapshot.epoch
        else { throw ShellServiceError("The service changed before the answer.") }
        if case .always(let entry) = decision.answer {
          do {
            try await client.addShellAllowlistEntry(entry)
          } catch {
            Self.log.error(
              "The allowlist entry was not saved: \(String(describing: error), privacy: .public)")
            self?.presentation.answerFailed(key, request: request, notice: .allowlistFailed)
            return
          }
        }
        try await client.replyToConfirm(decision.reply)
        return
      } catch ShellClientError.http(let status, _, _) where status == 409 || status == 410 {
        notice = .stale
      } catch {
        Self.log.error(
          "A task's answer was not taken: \(String(describing: error), privacy: .public)")
        notice = .failed
      }
      self?.presentation.answerFailed(key, request: request, notice: notice)
    }
  }

  /// Opens the window a view waits in, where the person answers it; the card stays open.
  private func openView(_ request: TaskActivityPendingRequest, of key: TaskActivityRunKey) {
    guard case .view(let callID, let title) = request.kind, let shell,
      let run = snapshot?.runs.first(where: { Self.key($0) == key })
    else { return }
    // A view window's title is 1 to 120 characters (`ViewOpenParams`).
    let named = [title, run.title].first { !$0.isEmpty }.map { String($0.prefix(120)) }
    do {
      try shell.openView(
        ViewOpenParams(
          taskId: key.taskID, callId: callID, title: named ?? callID, width: nil, height: nil))
    } catch {
      Self.log.error("A view did not open: \(error.message, privacy: .public)")
    }
  }

  private func stop(_ key: TaskActivityRunKey) {
    guard let shell, let snapshot,
      let run = snapshot.runs.first(where: { Self.key($0) == key }),
      !run.status.isTerminal, stops[key] != .requested,
      run.status != .stopping || stops[key] == .unconfirmed
    else { return }
    stops[key] = .requested
    dismissed.insert(key)
    refresh()
    Task { [weak self] in
      do {
        let client = try await shell.services.client()
        guard client.endpoint.serviceId == snapshot.serviceId,
          client.endpoint.epoch == snapshot.epoch
        else { throw ShellServiceError("The service changed before cancellation.") }
        let unsent = try await client.cancelRun(taskId: key.taskID, runId: key.runID)
        guard let self, self.snapshot?.serviceId == snapshot.serviceId,
          self.snapshot?.epoch == snapshot.epoch
        else { return }
        if !unsent.steering.isEmpty || !unsent.followUp.isEmpty {
          shell.panelHost.send(
            .taskQueueWithdrawn(
              .init(
                taskId: key.taskID, runId: key.runID,
                unsent: .init(steering: unsent.steering, followUp: unsent.followUp))))
        }
        // The response acknowledges the request. Only the service snapshot confirms stopped.
        refresh()
      } catch {
        guard let self, self.snapshot?.serviceId == snapshot.serviceId,
          self.snapshot?.epoch == snapshot.epoch, self.stops[key] != nil
        else { return }
        self.stops[key] = .unconfirmed
        Self.log.error(
          "A task stop could not be confirmed: \(String(describing: error), privacy: .public)")
        self.refresh()
      }
    }
  }

  private func contains(_ key: TaskActivityRunKey) -> Bool {
    snapshot?.runs.contains { Self.key($0) == key } == true
  }

  private static func key(_ run: TaskActivityRunWire) -> TaskActivityRunKey {
    .init(taskID: run.taskId, runID: run.runId)
  }

  private static func revision(_ request: TaskActivityRequestWire) -> TaskActivityRequestRevision {
    switch request {
    case .confirmation(let confirmation):
      .init(id: confirmation.requestId, revision: confirmation.revision)
    case .input(let input): .init(id: input.requestId, revision: input.revision)
    }
  }
}
