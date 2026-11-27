import AICore
import Darwin
import Foundation

/// The `chrome` engine (D5, D8–D10): browser bindings on the `chrome` channel, in the person's own
/// Chrome connected through Atd for Chrome, for attended runs only. It drives the same browser
/// worker as the managed engine, through the shared ``BrowserPageDriver``, with its own
/// ``BrowserWorkerPool``: one worker per connected Chrome (keyed by the pairing's installation id,
/// with the connection's generation as `contextId`), started with `ATD_BROWSER_CHANNEL=chrome` and
/// attached to that Chrome's ``ChromeCDPRelay``, where the extension exposes only the tabs a run
/// owns (D9). It never calls `open_page` or `restore_windows`, names no download directory (Chrome
/// keeps the person's downloads), and opens nothing itself: an approved website opens through the
/// access preparer's `tab.open`.
///
/// A ref names a tab the extension reports as owned by the run that resolved it, by its CDP target
/// id; Chrome going away makes it `targetUnavailable` (`chromeDisconnected`), a new connection or
/// the tab being released `targetChanged`. Whether the person is using a tab comes from the
/// extension (``isInFront(_:)``, ``isHeld(_:)``, ``lastInput(on:)``), never from the worker.
///
/// `upload` is in the profile, since the worker can set files where Chrome lets the extension read
/// them; a ref of a Chrome without that access ("Allow access to file URLs" off, `fileAccess`
/// false) lists no `upload` capability, and an upload step there is refused `unsupported` before
/// anything is sent (``perform(_:on:observation:context:)``).
final class ChromeBrowserEngine: ComputerEngine, BrowserPageOwner {
  let id = ComputerEngineID.chrome
  private(set) var profile: CapabilityProfileWire
  private(set) var generation: Int?
  let links: ChromeLinks
  let workers: BrowserWorkerPool
  /// The refs, their surfaces and observations, and every worker call on their pages.
  let driver: BrowserPageDriver
  /// The relay of each connected Chrome, by installation id.
  var relays: [String: ChromeCDPRelay] = [:]
  /// The run each live ref was resolved for: only that run's tabs are the ref's pages.
  var runs: [String: String] = [:]
  private var binaries: EngineBinaries
  private var starts = 0
  private let onShellLog: (ShellLogWriter.Level, String, String) -> Void

  init(
    links: ChromeLinks, workers: BrowserWorkerPool, binaries: EngineBinaries, uploadRoot: URL,
    onShellLog: @escaping (ShellLogWriter.Level, String, String) -> Void = { _, _, _ in }
  ) {
    self.links = links
    self.workers = workers
    self.binaries = binaries
    self.onShellLog = onShellLog
    driver = BrowserPageDriver(
      workers: workers, uploadRoot: uploadRoot, downloadsRoot: nil, onLog: onShellLog)
    profile = Self.makeProfile(workerReady: BrowserWorkerPool.isStaged(binaries))
    driver.owner = self
    links.observe(
      connected: { [weak self] in self?.connected($0) }, gone: { [weak self] in self?.gone($0) })
  }

  // MARK: Lifecycle

  /// Installed while the `computer-browser` add-on is (``EngineBinaries/browserWorker``).
  var isInstalled: Bool { binaries.browserWorker != nil }

  func install(_ binaries: EngineBinaries) -> Bool {
    let changed = binaries.browserWorker != self.binaries.browserWorker
    self.binaries = binaries
    workers.binaries = binaries
    profile = Self.makeProfile(workerReady: BrowserWorkerPool.isStaged(binaries))
    return changed
  }

  func start() async throws {
    guard generation == nil else { return }
    let ready = BrowserWorkerPool.isStaged(binaries)
    profile = Self.makeProfile(workerReady: ready)
    guard ready else { throw BrowserWorkerPool.notStaged(binaries) }
    starts += 1
    generation = starts
  }

  /// Stops the workers; the relays stay with their connections for the next start.
  func shutdown() async {
    generation = nil
    driver.reset()
    runs = [:]
    await workers.shutdownAll()
  }

  func cancel(operationId: String) async {
    await workers.cancel(operationId: operationId)
  }

  /// The bound tab: every action on the target, also on one of its popups, queues behind it.
  func resources(for ref: TargetRefWire) -> Set<DeviceResource> {
    guard let page = ref.browser else { return [] }
    return [.page(profileId: page.profileId, contextId: page.contextId, pageId: page.pageId)]
  }

  /// The person's Chrome, the native host's parent process, while the ref's connection lasts.
  func foregroundProcess(of ref: TargetRefWire) -> pid_t? {
    link(of: ref)?.browserPid
  }

  /// Drops what was kept for the ref; Atd for Chrome detaches from its tabs when the run ends.
  func releaseTarget(_ ref: TargetRefWire) async {
    driver.forget([ref.id])
    runs[ref.id] = nil
  }

  // MARK: Pages

  func observe(
    _ ref: TargetRefWire, _ operation: ObserveOperationWire, context: EngineObserveContext
  )
    async throws(ComputerFailure) -> ObservationWire
  {
    try await driver.observe(ref, operation, effects: profile.effects, context: context)
  }

  func invalidateObservation(_ ref: TargetRefWire) {
    driver.invalidateObservation(refId: ref.id)
  }

  func perform(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    if case .upload = step, link(of: ref)?.fileAccess != true {
      throw ComputerFailure(
        .unsupported,
        "Uploading in the person's own Chrome needs Atd for Chrome to be allowed access to file "
          + "URLs (chrome://extensions, Atd for Chrome, Details). Nothing was sent; ask the person "
          + "to allow it or to choose the file themselves.")
    }
    return try await driver.perform(step, on: ref, observation: observation, context: context)
  }

  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?,
    context _: EngineCheckContext
  ) async throws(ComputerFailure) -> Bool {
    try await driver.check(condition, on: ref, baseline: baseline)
  }

  // MARK: Connections

  /// A paired Chrome connected: its worker attaches through a relay of its own.
  private func connected(_ link: ChromeLink) {
    relays[link.installationId]?.stop()
    let relay = ChromeCDPRelay(
      link: link,
      onDiagnostic: { [onShellLog] level, message in
        onShellLog(level, "chrome-cdp", message)
      })
    relays[link.installationId] = relay
    relay.start()
  }

  /// A paired Chrome went away: its relay and worker end, and its refs answer
  /// `chromeDisconnected` from now on (``endpoint(of:refId:)``).
  private func gone(_ link: ChromeLink) {
    guard links.link(link.installationId) == nil else { return }
    relays.removeValue(forKey: link.installationId)?.stop()
    let workers = workers
    Task {
      await workers.stop(profileId: link.installationId, contextId: link.contextId)
    }
  }

  /// The connection a ref was resolved on, while it lasts.
  func link(of ref: TargetRefWire) -> ChromeLink? {
    guard let page = ref.browser, let link = links.link(page.profileId),
      link.contextId == page.contextId
    else { return nil }
    return link
  }
}

extension ChromeBrowserEngine: ComputerPreviewProviding {
  /// The worker's screencast of the tab, carried by the relay like every other CDP message.
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
  {
    try await driver.previewSource(ref, observation: observation)
  }
}

/// The worker endpoint of one connected Chrome: its relay's websocket, keyed by the pairing.
struct ChromeWorkerEndpoint: BrowserWorkerEndpoint {
  let profileId: String
  let contextId: String
  let webSocketURL: String
  var channel: BrowserWorkerChannel { .chrome }
  let pid: pid_t
  let processStart: String
}
