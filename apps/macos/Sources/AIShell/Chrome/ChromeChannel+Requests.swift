import AIChromeChannelKit
import AICore
import AIRelay
import Foundation

/// A paired extension's requests (D10, D12), each turned into the service call the panel would
/// make. Answers, stops and follow-ups name runs; only runs this profile is shown (its
/// ``ChromeProjection`` runs) may be acted on from it.
extension ChromeChannel {
  func handlePaired(_ frame: ChromeInboundFrame, from session: ChromeSession) {
    guard let link = session.link else { return }
    // Chrome's infobar Cancel stops the run that owned the tab, before the link forgets the tab.
    if case .tabReleased(let tabId, .canceledByUser) = frame, let runId = link.tabs[tabId]?.runId,
      let taskId = projection.taskId(of: runId)
    {
      environment.stopRun(taskId, runId)
    }
    if link.apply(frame) { return }
    switch frame {
    case .ask(let ask): Task { await self.ask(ask, on: link) }
    case .runStop(let taskId, let runId):
      guard projection.shows(runId: runId, taskId: taskId, on: link) else { return }
      environment.stopRun(taskId, runId)
    case .requestAnswer(let taskId, let requestId, let revision, let answer):
      Task { await self.answer(taskId, requestId, revision, answer, on: link) }
    case .runFollowUp(let taskId, .saveAutomation):
      Task { await self.saveAsAutomation(taskId, on: link) }
    case .runDismiss(let taskId, let runId):
      projection.dismiss(runId: runId, taskId: taskId, on: link)
    case .siteSet(let origin, let allowed):
      Task { await self.setSite(origin: origin, allowed: allowed, link: link) }
    case .appOpen(let taskId):
      environment.openTask(taskId.flatMap { projection.shows(taskId: $0, on: link) ? $0 : nil })
    case .settingsOpen: environment.openComputerSettings()
    case .pairRequest:
      // Already paired: the welcome says so again (a secret goes out only when pairing).
      sendWelcome(session)
    case .hello, .pairCancel, .tabState, .tabReleased, .tabOpened, .tabOpenFailed, .tabHanded,
      .runHold, .cdp, .unknown:
      break
    }
  }

  // MARK: Asking

  /// `ask`: a task with the person's text and the page it came from, in their Chrome, on the
  /// site's binding when they allowed the site; the tab they asked from becomes the run's. An ask
  /// whose page the person removed (empty `url`) names no page and hands over no tab.
  private func ask(_ ask: ChromeAsk, on link: ChromeLink) async {
    let state = environment.hostState()
    guard state == .ready else {
      return link.send(.askFailed(requestId: ask.requestId, reason: state.rawValue))
    }
    let site = siteBinding(for: ask.url, on: link)
    let submit = ChromeTaskSubmit(
      operationId: Self.operationId(),
      text: Self.pagePrompt(ask.text, title: ask.title, url: ask.url),
      bindingIds: site.map { [$0.bindingId] } ?? [],
      usesChrome: true)
    do {
      let run = try await environment.client().submitChromeTask(submit)
      extensionRuns[run.runId] = .init(installationId: link.installationId, taskId: run.taskId)
      link.send(.askAccepted(requestId: ask.requestId, taskId: run.taskId, runId: run.runId))
      if !ask.url.isEmpty { link.hand(tabId: ask.tabId, runId: run.runId) }
      projection.refresh(link)
    } catch {
      Self.log.error("An ask from Chrome could not start a task.")
      link.send(.askFailed(requestId: ask.requestId, reason: "failed"))
    }
  }

  // MARK: Runs

  /// `request.answer`, for a request this profile was shown (``ChromeProjection`` lists only
  /// those the HUD may answer): a confirmation takes Allow once or Don't allow, never a grant for
  /// the session; a question takes one of the answers it listed.
  private func answer(
    _ taskId: String, _ requestId: String, _ revision: Int, _ answer: ChromePermissionAnswer,
    on link: ChromeLink
  ) async {
    let reply: ConfirmReply.Answer? =
      switch (projection.hudRequest(requestId, of: taskId, on: link), answer) {
      case (.confirmation?, .once): .once
      case (.confirmation?, .declined): .declined
      case (.input(_, _, _, let options)?, .text(let text)) where options.contains(text):
        .text(text)
      default: nil
      }
    guard let reply else {
      link.send(.error(ref: requestId, code: "answerRefused", message: "Answer it in Atd."))
      return projection.resend(link)
    }
    do {
      try await environment.client().replyToConfirm(
        ConfirmReply(requestId: requestId, revision: revision, answer: reply))
    } catch {
      // Answered elsewhere first, or replaced: the HUD shows the runs as they are now.
      link.send(.error(ref: requestId, code: "answerFailed", message: "The request has changed."))
      projection.resend(link)
    }
  }

  /// "Save as automation" (D12): asks Atd, in the task, to turn it into an automation on the
  /// managed browser profile. It only sends the request; the automation is saved in Atd.
  private func saveAsAutomation(_ taskId: String, on link: ChromeLink) async {
    guard projection.shows(taskId: taskId, on: link), let client = try? await environment.client()
    else {
      return link.send(
        .error(ref: taskId, code: "followUpFailed", message: "Atd could not send it."))
    }
    let instruction =
      "Turn what you just did in my Chrome into an automation. Automations run on Atd's managed "
      + "browser profile, not my own Chrome, so set it up there, and ask me before you save it."
    do {
      if projection.hasActiveRun(taskId: taskId) {
        try await client.queueFollowUp(taskId: taskId, text: instruction)
      } else {
        _ = try await client.submitChromeTask(
          ChromeTaskSubmit(
            operationId: Self.operationId(), text: instruction, bindingIds: [], usesChrome: false,
            taskId: taskId))
      }
    } catch {
      link.send(.error(ref: taskId, code: "followUpFailed", message: "Atd could not send it."))
    }
  }

  static func operationId() -> String { "chrome-" + UUID().uuidString.lowercased() }

  /// `TaskInputSchema`'s limit of `text`, in UTF-16 code units.
  static let taskTextLimit = 100_000

  /// The person's text with the page it came from, which the model reads, within the service's
  /// limit: the page is cut first, the person's own text only when it alone is too long.
  static func pagePrompt(_ text: String, title: String, url: String) -> String {
    let lead = "\n\nAsked from this page in my Chrome: "
    let room = taskTextLimit - text.utf16.count - lead.utf16.count
    guard !url.isEmpty, room > 0 else { return text.clipped(toUTF16: taskTextLimit) }
    let page = title.isEmpty ? url : "\(title) (\(url))"
    return text + lead + page.clipped(toUTF16: room)
  }
}
