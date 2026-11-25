import AIChromeChannelKit
import AICore
import Foundation

/// The `RunView`s of one profile: its live runs from task activity, then the ended runs it keeps,
/// at most ``ChromeProjection/maxRuns``, live first and newest first within each.
extension ChromeProjection {
  func views(for link: ChromeLink) -> [ChromeRunView] {
    let live = (snapshot?.runs ?? []).filter { !$0.status.isTerminal && isTied($0, to: link) }
      .sorted { $0.startedAt > $1.startedAt }
    // A newer run in one of an ended run's tabs replaces it there.
    let liveTabs = Set(live.flatMap { link.tabs(of: $0.runId).map(\.tabId) })
    ended[link.installationId] = ended[link.installationId]?.filter {
      Set($0.value.tabs).isDisjoint(with: liveTabs)
    }
    let kept = (ended[link.installationId] ?? [:]).values.sorted {
      $0.run.startedAt > $1.run.startedAt
    }
    let views =
      live.map { run in
        view(
          run, tabs: link.tabs(of: run.runId),
          fromExtension: channel.extensionRuns[run.runId] != nil,
          on: link)
      }
      + kept.map { view($0.run, endedTabs: $0.tabs, fromExtension: $0.fromExtension, on: link) }
    return Array(views.prefix(Self.maxRuns))
  }

  /// Whether `runId` is live and tied to `link`: started from it, owning its tabs or acting on
  /// one of its sites. Only such a run may claim a tab through `tab.state`'s `runId`; a late
  /// report never gives a tab back to a run that ended. A run the profile just started counts
  /// before task activity lists it.
  func isTied(_ runId: String, to link: ChromeLink) -> Bool {
    guard let run = snapshot?.runs.first(where: { $0.runId == runId }) else {
      return channel.extensionRuns[runId]?.installationId == link.installationId
        && !hasEnded(runId)
    }
    return !run.status.isTerminal && isTied(run, to: link)
  }

  private func isTied(_ run: TaskActivityRunWire, to link: ChromeLink) -> Bool {
    if channel.extensionRuns[run.runId]?.installationId == link.installationId { return true }
    if !link.tabs(of: run.runId).isEmpty { return true }
    guard case .browser(let target) = run.computer?.target, let bindingId = target.bindingId
    else { return false }
    return channel.environment.chromeBinding(bindingId)?.profileId == link.installationId
  }

  private func view(
    _ run: TaskActivityRunWire, tabs: [ChromeOwnedTab], fromExtension: Bool, on link: ChromeLink
  ) -> ChromeRunView {
    let focus = lastPage[run.runId].flatMap { page in tabs.first { $0.targetId == page } }
    return view(
      run, tabIds: tabs.map(\.tabId), focusTabId: (focus ?? tabs.first)?.tabId,
      held: tabs.contains(where: \.held), fromExtension: fromExtension, on: link)
  }

  private func view(
    _ run: TaskActivityRunWire, endedTabs: [Int], fromExtension: Bool, on link: ChromeLink
  ) -> ChromeRunView {
    view(
      run, tabIds: endedTabs, focusTabId: endedTabs.first, held: false,
      fromExtension: fromExtension, on: link)
  }

  private func view(
    _ run: TaskActivityRunWire, tabIds: [Int], focusTabId: Int?, held: Bool, fromExtension: Bool,
    on link: ChromeLink
  ) -> ChromeRunView {
    let status = status(of: run, held: held)
    let working = !run.status.isTerminal && status != .disconnected
    return ChromeRunView(
      taskId: run.taskId, runId: run.runId, title: run.title, status: status,
      step: working ? TaskActivityPresentation.progress(run) : nil, tabs: tabIds,
      focusTabId: focusTabId, requests: run.requests.compactMap { hud($0, of: run, on: link) },
      result: fromExtension && status == .done ? answers[run.runId] ?? nil : nil,
      problem: run.computer?.problem.map {
        .init(code: $0.code, message: TaskActivityPresentation.problem($0))
      },
      fromExtension: fromExtension)
  }

  private func status(of run: TaskActivityRunWire, held: Bool) -> ChromeRunView.Status {
    switch run.status {
    case .completed: return .done
    case .stopped, .cancelled: return .stopped
    case .failed, .interrupted, .unknown: return .failed
    case .queued, .running, .awaitingInput, .awaitingConfirmation, .stopping: break
    }
    // The computer host's state concerns only runs that operate the computer.
    guard current, run.computer == nil || snapshot?.hostState != .unavailable else {
      return .disconnected
    }
    if run.status == .stopping { return .stopping }
    // Waiting for the person, also on requests the HUD leaves to Atd ("Answer in Atd").
    if !run.requests.isEmpty || run.status == .awaitingInput
      || run.status == .awaitingConfirmation
    {
      return .attention
    }
    return held ? .held : .working
  }

  /// A request as the HUD may answer it, or nil when it must be answered in Atd (S1): an action
  /// on one of this profile's sites, access in the person's Chrome, or a question with suggested
  /// answers. Everything else (files, commands, tools, other computers, free-form questions and
  /// views) is answered where the whole request can be read.
  private func hud(
    _ request: TaskActivityRequestWire, of run: TaskActivityRunWire, on link: ChromeLink
  )
    -> ChromeHudRequest?
  {
    switch request {
    case .confirmation(let confirmation):
      let effect: String?
      switch confirmation.scope {
      case .computerAct(let act):
        guard channel.environment.chromeBinding(act.bindingId)?.profileId == link.installationId
        else { return nil }
        effect = act.effect.rawValue
      case .computerAccess(let access):
        guard access.channel == .chrome else { return nil }
        effect = nil
      case .file, .tool:
        return nil
      }
      return .confirmation(
        requestId: confirmation.requestId, revision: confirmation.revision,
        title: confirmation.title.isEmpty ? run.title : confirmation.title,
        detail: confirmation.detail, effect: effect)
    case .input(let input):
      guard !input.options.isEmpty, input.viewCallId == nil else { return nil }
      return .input(
        requestId: input.requestId, revision: input.revision,
        title: input.title.isEmpty ? run.title : input.title, options: input.options)
    }
  }
}
