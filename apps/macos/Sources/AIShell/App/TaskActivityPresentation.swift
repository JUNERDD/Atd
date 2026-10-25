import AICore
import AppKit

/// Display adaptation only. Service IDs and host-verified identities never come from titles,
/// the foreground app, or the conversation currently shown by the renderer.
enum TaskActivityPresentation {
  /// `hostLocked`: the computer host is locked, which only runs that operate the computer wait on.
  static func item(
    _ run: TaskActivityRunWire, phase: TaskActivityPhase, canShowPreview: Bool, hostLocked: Bool
  ) -> TaskActivityItem {
    let requests = phase == .waiting ? run.requests.map(request) : []
    let locked = phase == .waiting && requests.isEmpty && hostLocked && run.computer != nil
    return .init(
      key: .init(taskID: run.taskId, runID: run.runId), conversationTitle: run.title,
      title: run.title, source: source(run), computer: run.computer.map(target),
      phase: phase, requests: requests, locked: locked,
      detail: detail(run, phase: phase, requests: requests, locked: locked),
      canShowPreview: canShowPreview && run.computer != nil && !run.status.isTerminal)
  }

  /// A pending request as the card decides it in place, as the service described it.
  private static func request(_ wire: TaskActivityRequestWire) -> TaskActivityPendingRequest {
    switch wire {
    case .confirmation(let confirmation):
      return .init(
        id: confirmation.requestId, revision: confirmation.revision,
        subagent: confirmation.subagent,
        kind: .approval(
          .init(
            scope: confirmation.scope, detail: confirmation.detail,
            clipped: confirmation.detailClipped, allowlistEntry: confirmation.allowlistEntry,
            review: confirmation.review)))
    case .input(let input):
      let kind: TaskActivityPendingRequest.Kind =
        input.viewCallId.map { .view(callID: $0, title: input.title) }
        ?? .question(.init(title: input.title, options: input.options))
      return .init(
        id: input.requestId, revision: input.revision, subagent: input.subagent, kind: kind)
    }
  }

  private static func target(_ computer: ComputerActivityWire) -> TaskActivityApplication {
    switch computer.target {
    case .native(let target):
      return .init(
        name: target.appName, bundleID: target.bundleId, appPath: target.appPath,
        kind: .application)
    case .browser:
      // The browser engine explicitly owns managed Chrome. Its application identity is not
      // inferred from a website title or from whichever browser is in the foreground.
      let bundleID = ManagedChromeLaunch.bundleIdentifier
      let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
      let name =
        url.flatMap { try? $0.resourceValues(forKeys: [.localizedNameKey]).localizedName }
        ?? "Google Chrome"
      return .init(name: name, bundleID: bundleID, appPath: url?.path, kind: .browser)
    case nil:
      let shared = [.shareScreen, .watchScreen, .stopSharing].contains(computer.operation.op)
      return .init(
        name: ShellStrings.shared.text(
          shared ? .activitySharedScreen : .activityUnknownApplication),
        bundleID: nil, appPath: nil, kind: shared ? .screen : .unknown)
    }
  }

  /// An automation keeps its own glyph; any other task shows its model provider's mark.
  private static func source(_ run: TaskActivityRunWire) -> TaskActivityApplication {
    let (key, kind): (TaskActivityStringKey, TaskActivityApplication.Kind) =
      switch run.source {
      case .conversation: (.activitySourceConversation, .conversation)
      case .command: (.activitySourceCommand, .command)
      case .automation: (.activitySourceAutomation, .automation)
      case .app: (.activitySourceApp, .userApp)
      }
    return .init(
      name: ShellStrings.shared.text(key), bundleID: nil, appPath: nil, kind: kind,
      mark: run.source == .automation ? nil : ProviderBrands.asset(for: run.provider))
  }

  private static func detail(
    _ run: TaskActivityRunWire, phase: TaskActivityPhase,
    requests: [TaskActivityPendingRequest], locked: Bool
  ) -> String {
    let stateKey: TaskActivityStringKey? =
      switch phase {
      case .disconnected:
        run.computer == nil ? .activityServiceDisconnectedNote : .activityDisconnectedNote
      case .stopPending: .activityStopPendingNote
      case .stopping: .activityStoppingNote
      case .stopped: .activityStoppedNote
      case .completed: .activityCompleted
      case .failed: .activityFailedNote
      case .running, .waiting: nil
      }
    if let stateKey { return ShellStrings.shared.text(stateKey) }
    if let problem = run.computer?.problem, !problem.message.isEmpty { return problem.message }
    if phase == .waiting {
      // How many requests wait, or what the one waiting asks for.
      if requests.count > 1 {
        return String(
          format: ShellStrings.shared.text(TaskActivityStringKey.activityWaitingMany),
          locale: Locale(identifier: ShellStrings.shared.language.rawValue), requests.count)
      }
      let key: TaskActivityStringKey =
        switch requests.first?.kind {
        case .approval: .activityApprovalNote
        case .question, .view: .activityAnswerNote
        case nil: locked ? .activityLockedNote : .activityWaitingNote
        }
      return ShellStrings.shared.text(key)
    }
    if let operation = run.computer?.operation {
      let summary = operation.summary.flatMap { $0.isEmpty ? nil : $0 }
      if operation.inFlight { return summary ?? ShellStrings.shared.text(operationKey(operation)) }
      if run.step == nil, let summary { return summary }
    }
    return ShellStrings.shared.text(stepKey(run))
  }

  private static func operationKey(_ operation: ComputerActivityOperationWire)
    -> TaskActivityStringKey
  {
    switch operation.op {
    case .targets: .activityDetailPreparingTarget
    case .requestAccess: .activityDetailRequestingAccess
    case .shareScreen: .activityDetailSharingScreen
    case .watchScreen: .activityDetailReadingScreen
    case .stopSharing, .release: .activityDetailFinishingOperation
    case .observe: .activityDetailObserving
    case .act:
      operation.stepKind == .wait ? .activityDetailWaitingForCondition : .activityDetailOperating
    case .status: .activityDetailWorking
    }
  }

  /// What the run is doing between computer operations, or throughout a run without them.
  private static func stepKey(_ run: TaskActivityRunWire) -> TaskActivityStringKey {
    switch run.step {
    case .thinking: return .activityDetailThinking
    case .responding: return .activityDetailResponding
    case .command: return .activityDetailRunningCommand
    case .reading: return .activityDetailReadingFiles
    case .editing: return .activityDetailEditingFiles
    case .tool: return .activityDetailUsingTool
    case nil:
      if run.status == .queued { return .activityDetailStarting }
      return run.computer == nil ? .activityDetailWorking : .activityDetailContinuingTask
    }
  }
}

extension TaskActivityRunWire.Status {
  var isTerminal: Bool {
    switch self {
    case .completed, .stopped, .cancelled, .failed, .interrupted, .unknown: true
    case .queued, .running, .awaitingInput, .awaitingConfirmation, .stopping: false
    }
  }
}
