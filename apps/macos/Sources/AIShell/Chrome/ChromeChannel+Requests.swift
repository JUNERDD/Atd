import AIChromeChannelKit
import AICore
import AIRelay
import Foundation

/// Bounded FIFO deduplicator for HUD input attribution keys so repeated frames cannot replay.
struct ChromeAttributionDedup {
  static let capacity = 128
  private var seen: Set<String> = []
  private var order: [String] = []

  mutating func insert(_ key: String) -> Bool {
    guard seen.insert(key).inserted else { return false }
    order.append(key)
    if order.count > Self.capacity { seen.remove(order.removeFirst()) }
    return true
  }
}

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
    if case .runHold(_, let runId, let tabId, false, let ownInput) = frame,
      let tab = link.tabs[tabId], tab.runId == runId, tab.held, tab.active
    {
      environment.onChromeOwnInput(ownInput, link.browserPid)
    }
    if link.apply(frame) { return }
    switch frame {
    case .ask(let ask):
      if environment.hostState() == .ready,
        attributedInputs.insert("\(link.installationId):ask:\(ask.requestId)")
      {
        environment.onChromeOwnInput(ask.ownInput, link.browserPid)
      }
      Task { await self.ask(ask, on: link) }
    case .runStop(let taskId, let runId):
      guard projection.shows(runId: runId, taskId: taskId, on: link) else { return }
      environment.stopRun(taskId, runId)
    case .requestAnswer(let taskId, let requestId, let revision, let answer, let ownInput):
      handleAnswer(taskId, requestId, revision, answer, ownInput: ownInput, on: link)
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
      operationId: Self.operationId(), text: ask.text.clipped(toUTF16: Self.taskTextLimit),
      page: Self.askedPage(ask), bindingIds: site.map { [$0.bindingId] } ?? [], usesChrome: true)
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
  /// the session; a question takes one of the answers it listed. Verifies `revision`, deduplicates,
  /// and attributes non-declined HUD events synchronously before any network hop.
  private func handleAnswer(
    _ taskId: String, _ requestId: String, _ revision: Int, _ answer: ChromePermissionAnswer,
    ownInput: ChromeOwnInput?, on link: ChromeLink
  ) {
    let shown = projection.hudRequest(requestId, of: taskId, on: link)
    let reply: ConfirmReply.Answer? =
      switch (shown, shown?.revision == revision, answer) {
      case (.confirmation?, true, .once): .once
      case (.confirmation?, true, .declined): .declined
      case (.input(_, _, _, let options)?, true, .text(let text)) where options.contains(text):
        .text(text)
      default: nil
      }
    guard let reply else {
      link.send(.error(ref: requestId, code: "answerRefused", message: "Answer it in Atd."))
      return projection.resend(link)
    }
    if reply != .declined,
      attributedInputs.insert("\(link.installationId):answer:\(taskId):\(requestId):\(revision)")
    {
      environment.onChromeOwnInput(ownInput, link.browserPid)
    }
    Task { await self.sendAnswer(requestId, revision, reply, on: link) }
  }

  private func sendAnswer(
    _ requestId: String, _ revision: Int, _ reply: ConfirmReply.Answer, on link: ChromeLink
  ) async {
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
  /// `AskedPageSchema`'s limits of `title` and `url`, in UTF-16 code units.
  static let pageTitleLimit = 4_096
  static let pageURLLimit = 8_192

  /// The page an ask came from, within `AskedPageSchema`'s limits, with the elements the person
  /// picked on it in order, which pass whole (the schema allows twice the extension's limits); nil
  /// for an ask whose page the person removed, which names no elements either. The service tells
  /// the model about it in the room the person's text leaves, each value from the page kept on
  /// its line (`pageInstruction`), and names the task by the person's text alone.
  static func askedPage(_ ask: ChromeAsk) -> ChromeTaskSubmit.Page? {
    guard !ask.url.isEmpty else { return nil }
    return ChromeTaskSubmit.Page(
      title: ask.title.clipped(toUTF16: pageTitleLimit),
      url: ask.url.clipped(toUTF16: pageURLLimit),
      elements: (ask.elements ?? []).map {
        .init(label: $0.label, selector: $0.selector, text: $0.text)
      })
  }
}
