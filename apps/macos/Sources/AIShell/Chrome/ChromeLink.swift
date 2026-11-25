import AIChromeChannelKit
import AICore
import Darwin
import Foundation

/// A tab of the person's Chrome that an Atd run owns (D9), as the extension last reported it.
struct ChromeOwnedTab: Equatable, Sendable {
  let tabId: Int
  /// The tab's CDP target id, the chrome engine's `pageId`; nil until the extension knows it.
  var targetId: String?
  /// The run the tab was handed to or opened for; nil for a tab the extension reports before the
  /// shell learned whose it is.
  var runId: String?
  var url: String
  var title: String
  var active: Bool
  var focused: Bool
  /// When the person last typed, clicked or scrolled in the tab.
  var lastInputAt: Date?
  /// The person took over (`run.hold`): the run must not act in the tab until handed back.
  var held = false
}

/// A `tab.hand` the shell sent, which the extension's `tab.handed` answers.
private struct HandRequest: Hashable {
  let runId: String
  let tabId: Int
}

/// Why opening a tab for a run failed.
enum ChromeTabOpenError: Error, Equatable {
  /// The connection to this Chrome ended first.
  case disconnected
  /// The extension did not report the tab in time.
  case timedOut
  /// The extension could not open or own the tab (`tab.openFailed`).
  case refused
}

/// One connected, paired Chrome profile: the authenticated end of a channel session, which the
/// chrome engine drives and the projection reports to. It owns what the extension reported of the
/// tabs Atd runs own and the shell's requests to own or open one; the session applies the
/// extension's tab frames here (``apply(_:)``) and the engine reads them.
final class ChromeLink {
  /// The pairing's installation id: the chrome binding's `profileId`.
  let installationId: String
  /// Distinct for every connection of this shell: the chrome engine's `contextId`, so refs of an
  /// earlier connection go stale.
  let generation: Int
  /// Chrome's browser process (the native host's parent), which the person uses for these tabs.
  let browserPid: pid_t
  let chromeVersion: String
  /// Whether the extension may read file URLs, which `upload` needs.
  let fileAccess: Bool
  /// The paired profile as Settings names it.
  let label: String
  private(set) var tabs: [Int: ChromeOwnedTab] = [:]
  /// The `tab.hand` requests not answered yet: a `tab.handed` counts only for one of them.
  private var hands: Set<HandRequest> = []
  private let sendFrame: (ChromeOutboundFrame) -> Void
  private var openings: [String: (runId: String, done: CheckedContinuation<Int, any Error>)] = [:]
  private var requests = 0
  private(set) var isConnected = true

  /// Told after every change of ``tabs`` (state, ownership, a hold, a release).
  var onTabsChange: ((ChromeLink) -> Void)?
  /// Whether a run is already tied to this Chrome (it started here, owns a tab here or acts on
  /// one of its sites): only such a run may claim a tab through `tab.state`'s `runId`.
  var isTied: (String) -> Bool = { _ in false }
  /// CDP text the extension sent for worker connection `conn` (the engine's relay sets it).
  var onCDP: ((_ conn: String, _ msg: String) -> Void)?

  init(
    installationId: String, generation: Int, browserPid: pid_t, chromeVersion: String,
    fileAccess: Bool, label: String, send: @escaping (ChromeOutboundFrame) -> Void
  ) {
    self.installationId = installationId
    self.generation = generation
    self.browserPid = browserPid
    self.chromeVersion = chromeVersion
    self.fileAccess = fileAccess
    self.label = label
    sendFrame = send
  }

  /// `contextId` of the engine's target refs.
  var contextId: String { "c\(generation)" }

  func send(_ frame: ChromeOutboundFrame) {
    guard isConnected else { return }
    sendFrame(frame)
  }

  /// The tabs owned by `runId`.
  func tabs(of runId: String) -> [ChromeOwnedTab] {
    tabs.values.filter { $0.runId == runId }.sorted { $0.tabId < $1.tabId }
  }

  /// The owned tab whose CDP target is `targetId`.
  func tab(targetId: String) -> ChromeOwnedTab? {
    tabs.values.first { $0.targetId == targetId }
  }

  /// Asks the extension to own `tabId` for `runId` (`tab.hand`); `tab.handed` confirms it.
  func hand(tabId: Int, runId: String) {
    hands.insert(HandRequest(runId: runId, tabId: tabId))
    send(.tabHand(runId: runId, tabId: tabId))
  }

  /// `runId` ended: its tabs are no longer the shell's to drive (the extension releases them).
  func endRun(_ runId: String) {
    let ended = tabs.filter { $0.value.runId == runId }.map(\.key)
    hands = hands.filter { $0.runId != runId }
    guard !ended.isEmpty else { return }
    for tabId in ended { tabs[tabId] = nil }
    onTabsChange?(self)
  }

  /// Opens `url` in a background tab of the `Atd` group for `runId` (`tab.open`) and returns the
  /// new tab once the extension reported it (`tab.opened`).
  func openTab(url: String, runId: String, timeout: Duration) async throws(ChromeTabOpenError)
    -> ChromeOwnedTab
  {
    guard isConnected else { throw .disconnected }
    requests += 1
    let requestId = "open\(generation)-\(requests)"
    let timer = Task { [weak self] in
      try? await Task.sleep(for: timeout)
      self?.finishOpening(requestId, .failure(ChromeTabOpenError.timedOut))
    }
    defer { timer.cancel() }
    let tabId: Int
    do {
      tabId = try await withCheckedThrowingContinuation { done in
        openings[requestId] = (runId, done)
        send(.tabOpen(requestId: requestId, runId: runId, url: url))
      }
    } catch {
      throw error as? ChromeTabOpenError ?? .disconnected
    }
    guard let tab = tabs[tabId] else { throw .disconnected }
    return tab
  }

  /// Applies one of the extension's tab frames; false for every other frame.
  @discardableResult
  func apply(_ frame: ChromeInboundFrame) -> Bool {
    switch frame {
    case .tabState(let state):
      var tab =
        tabs[state.tabId]
        ?? ChromeOwnedTab(
          tabId: state.tabId, url: state.url, title: state.title, active: state.active,
          focused: state.focused)
      tab.targetId = state.targetId ?? tab.targetId
      if let runId = state.runId, isTied(runId) { tab.runId = runId }
      tab.url = state.url
      tab.title = state.title
      tab.active = state.active
      tab.focused = state.focused
      tab.lastInputAt = state.lastInputAt.map { Date(timeIntervalSince1970: $0 / 1000) }
      tabs[state.tabId] = tab
    case .tabOpened(let requestId, let tabId, let targetId):
      guard let opening = openings[requestId] else { return true }
      own(tabId: tabId, targetId: targetId, runId: opening.runId)
      finishOpening(requestId, .success(tabId))
    case .tabOpenFailed(let requestId, let reason):
      ChromeChannel.log.error("Chrome did not open a tab: \(reason, privacy: .public)")
      finishOpening(requestId, .failure(ChromeTabOpenError.refused))
      return true
    case .tabHanded(let runId, let tabId, let targetId):
      // Only the answer to a `tab.hand` this shell sent makes a tab a run's.
      guard hands.remove(HandRequest(runId: runId, tabId: tabId)) != nil else { return true }
      own(tabId: tabId, targetId: targetId, runId: runId)
    case .tabReleased(let tabId, _):
      tabs[tabId] = nil
      hands = hands.filter { $0.tabId != tabId }
    case .runHold(_, let runId, let tabId, let held):
      guard tabs[tabId]?.runId == runId else { return true }
      tabs[tabId]?.held = held
    case .cdp(let conn, let msg):
      onCDP?(conn, msg)
      return true
    default:
      return false
    }
    onTabsChange?(self)
    return true
  }

  /// The connection ended: pending openings fail and nothing more is sent.
  func disconnected() {
    isConnected = false
    for requestId in Array(openings.keys) {
      finishOpening(requestId, .failure(ChromeTabOpenError.disconnected))
    }
    tabs = [:]
    hands = []
    onTabsChange?(self)
  }

  private func own(tabId: Int, targetId: String, runId: String) {
    var tab =
      tabs[tabId]
      ?? ChromeOwnedTab(tabId: tabId, url: "", title: "", active: false, focused: false)
    tab.targetId = targetId
    tab.runId = runId
    tabs[tabId] = tab
  }

  private func finishOpening(_ requestId: String, _ result: Result<Int, any Error>) {
    guard let opening = openings.removeValue(forKey: requestId) else { return }
    opening.done.resume(with: result)
  }
}

/// The paired Chrome profiles connected now, by installation id, and who learns when one comes or
/// goes. The channel adds and removes links; the chrome engine and the projection observe them.
final class ChromeLinks {
  private(set) var links: [String: ChromeLink] = [:]
  private var observers: [(connected: (ChromeLink) -> Void, gone: (ChromeLink) -> Void)] = []

  func link(_ installationId: String) -> ChromeLink? { links[installationId] }

  /// The link whose tabs `runId` owns, if any.
  func link(owning runId: String) -> ChromeLink? {
    links.values.first { !$0.tabs(of: runId).isEmpty }
  }

  /// Calls `connected` for every link that connects (and each one connected now), `gone` for
  /// every one whose connection ended.
  func observe(
    connected: @escaping (ChromeLink) -> Void, gone: @escaping (ChromeLink) -> Void
  ) {
    observers.append((connected, gone))
    for link in links.values { connected(link) }
  }

  func add(_ link: ChromeLink) {
    if let earlier = links[link.installationId] { remove(earlier) }
    links[link.installationId] = link
    for observer in observers { observer.connected(link) }
  }

  func remove(_ link: ChromeLink) {
    guard links[link.installationId] === link else { return }
    links[link.installationId] = nil
    link.disconnected()
    for observer in observers { observer.gone(link) }
  }
}
