import AIChromeChannelKit
import AICore
import Foundation

/// A run Atd for Chrome started (an `ask`): a new task, or the next turn of one it started.
struct ChromeExtensionRun: Equatable {
  let installationId: String
  let taskId: String
  /// What the person sent to start it, as submitted.
  let prompt: String
}

/// Projects the service's task activity and the chrome engine's progress onto every connected
/// Chrome profile (D10): the runs tied to it (`runs`, at most 8, sent whenever they change) and the
/// live pointer (`pointer`). A run is tied to a profile when the profile started it, when it owns
/// one of the profile's tabs, or when it acts on one of the profile's sites. Only runs a profile
/// was shown, and only the requests its HUD may answer, may be acted on from it.
///
/// An ended run the profile started or whose tabs it owned stays in its HUD (S10) after the
/// service stops listing it: until the person dismisses it, a newer run of another task takes over
/// one of its tabs (the next turn of the same conversation keeps it, an earlier turn), or
/// ``keepEnded`` passed.
final class ChromeProjection {
  /// How much of a run's reply the HUD shows, as much as task activity carries of a live one
  /// (`TASK_ACTIVITY_REPLY_CHARS`).
  static let resultLimit = 2_000
  static let maxRuns = 8
  static let keepEnded: Duration = .seconds(30 * 60)

  /// An ended run kept for a profile, with the tabs it owned when it ended.
  struct Ended {
    var run: TaskActivityRunWire
    let tabs: [Int]
    let fromExtension: Bool
    let since: ContinuousClock.Instant
  }

  unowned let channel: ChromeChannel
  private(set) var snapshot: TaskActivitySnapshotWire?
  /// Whether ``snapshot`` is the service's current one; false from a disconnect until the next
  /// full snapshot, while the runs show as disconnected.
  private(set) var current = false
  private var sent: [String: [ChromeRunView]] = [:]
  /// Ended runs kept per profile (installation id), by run id.
  var ended: [String: [String: Ended]] = [:]
  /// Runs the person dismissed; they are not kept again while the service still lists them.
  private var dismissed: Set<String> = []
  /// The answers of finished extension runs, once read from their task (nil: it gave none).
  var answers: [String: ChromeRunView.Result?] = [:]
  /// The last message each extension run wrote while it ran: what a run that just ended shows
  /// until its answer is read, and in its place should the read fail.
  private var lastReplies: [String: TaskActivityReplyWire] = [:]
  /// Finished extension runs already settled (answer read).
  private var settled: Set<String> = []
  /// The page each run last acted on, which the HUD focuses.
  var lastPage: [String: String] = [:]

  init(channel: ChromeChannel) {
    self.channel = channel
  }

  // MARK: Inputs

  func receive(_ next: TaskActivitySnapshotWire) {
    if let snapshot, snapshot.serviceId == next.serviceId, snapshot.epoch == next.epoch,
      next.revision < snapshot.revision
    {
      return
    }
    snapshot = next
    current = true
    for run in next.runs where channel.extensionRuns[run.runId] != nil {
      if let reply = run.reply { lastReplies[run.runId] = reply }
    }
    for run in next.runs where run.status.isTerminal {
      for link in channel.links.links.values { keepIfEnded(run, on: link) }
      if channel.extensionRuns[run.runId] != nil { settle(run) }
    }
    forgetGone(listed: Set(next.runs.map(\.runId)))
    refreshAll()
  }

  /// The control stream connected or went away; a reconnect waits for its full snapshot.
  func connectionChanged() {
    current = false
    refreshAll()
  }

  func linkConnected(_ link: ChromeLink) {
    sent[link.installationId] = nil
    link.isTied = { [weak self, weak link] runId in
      guard let self, let link else { return false }
      return isTied(runId, to: link)
    }
    refresh(link)
  }

  func tabsChanged(_ link: ChromeLink) {
    refresh(link)
  }

  /// `run.dismiss`: the HUD's Dismiss on an ended run.
  func dismiss(runId: String, taskId: String, on link: ChromeLink) {
    guard ended[link.installationId]?[runId]?.run.taskId == taskId else { return }
    ended[link.installationId]?[runId] = nil
    dismissed.insert(runId)
    refresh(link)
  }

  /// A progress frame of the computer host: on the person's own Chrome it becomes the pointer of
  /// the page the step acts on.
  func progress(_ frame: ComputerProgressWire, ref: TargetRefWire) {
    guard ref.engine == .chrome, let browser = ref.browser,
      let link = channel.links.link(browser.profileId), link.contextId == browser.contextId
    else { return }
    var pageId = browser.pageId
    var rect: ChromePointer.Rect?
    var viewport: ChromePointer.Size?
    if case .viewport(let page, let area, let width, let height) = frame.geometry {
      pageId = page
      rect = .init(x: area.x, y: area.y, width: area.width, height: area.height)
      viewport = .init(width: width, height: height)
    }
    link.send(
      .pointer(
        .init(
          pageId: pageId, phase: frame.phase.rawValue, label: frame.label?.rawValue ?? "",
          rect: rect, viewport: viewport)))
    if lastPage[frame.runId] != pageId {
      lastPage[frame.runId] = pageId
      refresh(link)
    }
  }

  // MARK: Queries

  func taskId(of runId: String) -> String? {
    snapshot?.runs.first { $0.runId == runId }?.taskId ?? channel.extensionRuns[runId]?.taskId
  }

  /// Whether `runId` ended: settled, or kept as ended for some profile.
  func hasEnded(_ runId: String) -> Bool {
    settled.contains(runId) || ended.values.contains { $0[runId] != nil }
  }

  func hasActiveRun(taskId: String) -> Bool {
    snapshot?.runs.contains { $0.taskId == taskId && !$0.status.isTerminal } == true
  }

  /// Whether `link` was shown run `runId` of `taskId`, or started it.
  func shows(runId: String, taskId: String, on link: ChromeLink) -> Bool {
    if let origin = channel.extensionRuns[runId] {
      return origin.installationId == link.installationId && origin.taskId == taskId
    }
    return sent[link.installationId]?.contains { $0.runId == runId && $0.taskId == taskId } == true
  }

  /// Whether `link` was shown a run of `taskId`, or started one.
  func shows(taskId: String, on link: ChromeLink) -> Bool {
    channel.extensionRuns.values.contains {
      $0.installationId == link.installationId && $0.taskId == taskId
    } || sent[link.installationId]?.contains { $0.taskId == taskId } == true
  }

  /// The request `requestId` of `taskId` as `link`'s HUD was shown it, if it was: only requests
  /// the HUD may answer are ever shown (``hud(_:of:on:)``).
  func hudRequest(_ requestId: String, of taskId: String, on link: ChromeLink) -> ChromeHudRequest?
  {
    sent[link.installationId]?.lazy.filter { $0.taskId == taskId }
      .compactMap { $0.requests.first { $0.requestId == requestId } }.first
  }

  // MARK: Sending

  func refreshAll() {
    for link in channel.links.links.values { refresh(link) }
  }

  /// Sends `link` its runs when they changed.
  func refresh(_ link: ChromeLink) {
    guard link.isConnected else {
      sent[link.installationId] = nil
      return
    }
    let runs = views(for: link)
    guard sent[link.installationId] != runs else { return }
    sent[link.installationId] = runs
    link.send(.runs(runs))
  }

  /// Sends `link` its runs again, changed or not (an answer it gave did not apply).
  func resend(_ link: ChromeLink) {
    sent[link.installationId] = nil
    refresh(link)
  }

  // MARK: Ended runs

  /// Keeps `run`, which ended, for `link` when the profile started it or its tabs were the run's;
  /// either way the run's tabs are no longer the shell's to drive.
  private func keepIfEnded(_ run: TaskActivityRunWire, on link: ChromeLink) {
    let id = link.installationId
    if ended[id]?[run.runId] != nil {
      ended[id]?[run.runId]?.run = run
    } else if !dismissed.contains(run.runId) {
      let tabs = link.tabs(of: run.runId).map(\.tabId)
      let started = channel.extensionRuns[run.runId]?.installationId == id
      if started || !tabs.isEmpty {
        ended[id, default: [:]][run.runId] = Ended(
          run: run, tabs: tabs, fromExtension: channel.extensionRuns[run.runId] != nil,
          since: .now)
      }
    }
    link.endRun(run.runId)
  }

  /// Forgets ended runs past ``keepEnded``, and what the projection kept about runs neither the
  /// service nor any profile's HUD lists any more.
  private func forgetGone(listed: Set<String>) {
    let now = ContinuousClock.now
    dismissed = dismissed.filter { listed.contains($0) }
    for id in Array(ended.keys) {
      for (runId, run) in ended[id] ?? [:] where now - run.since >= Self.keepEnded {
        ended[id]?[runId] = nil
        // Not kept again should the service still list it.
        if listed.contains(runId) { dismissed.insert(runId) }
      }
    }
    let kept = Set(ended.values.flatMap(\.keys))
    let gone = { (runId: String) in !listed.contains(runId) && !kept.contains(runId) }
    for runId in settled where gone(runId) {
      settled.remove(runId)
      answers[runId] = nil
      channel.extensionRuns[runId] = nil
    }
    lastReplies = lastReplies.filter { !gone($0.key) }
    lastPage = lastPage.filter { !gone($0.key) }
  }

  /// Reads a finished extension run's answer for the HUD.
  private func settle(_ run: TaskActivityRunWire) {
    guard settled.insert(run.runId).inserted else { return }
    let completed = run.status == .completed
    Task { [weak self] in
      var text: String?
      if completed, let client = try? await self?.channel.environment.client() {
        text = (try? await client.runAnswer(taskId: run.taskId, runId: run.runId)) ?? nil
      }
      guard let self else { return }
      answers[run.runId] =
        text.map {
          ChromeRunView.Result(
            text: $0.clipped(toUTF16: Self.resultLimit), clipped: $0.utf16.count > Self.resultLimit)
        } ?? lastReply(of: run.runId)
      lastReplies[run.runId] = nil
      refreshAll()
    }
  }

  /// The last message `runId` wrote while it ran, as the reply of a run that is done.
  func lastReply(of runId: String) -> ChromeRunView.Result? {
    lastReplies[runId].map { .init(text: $0.text, clipped: $0.clipped) }
  }
}
