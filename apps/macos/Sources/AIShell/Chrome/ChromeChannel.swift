import AIChromeChannelKit
import AICore
import AIRelay
import AppKit
import Foundation
import OSLog

/// What the channel needs of the rest of the shell, as closures so it holds none of it.
struct ChromeChannelEnvironment {
  /// The shell's own service client (its main token); throws while the service is unavailable.
  let client: () async throws -> ShellClient
  /// Whether this shell can run tasks for the extension now.
  let hostState: () -> ChromeHostState
  let prefs: () -> ChromePrefs
  let appVersion: String
  /// Shows the panel, on `taskId`'s conversation when one is named.
  let openTask: (String?) -> Void
  /// Opens Settings › Computer use.
  let openComputerSettings: () -> Void
  /// Stops the computer work of one run (`run.stop`, infobar Cancel).
  let stopRun: (_ taskId: String, _ runId: String) -> Void
  /// `computer.state` changed: a pairing, a connection, a site or the host manifest.
  let onStateChange: () -> Void
  /// The binding of that id as a site of the person's own Chrome, when the shell knows it is one.
  let chromeBinding: (String) -> TargetBindingWire.Browser?
  /// Notes verified HUD input timestamps for `browserPid` so host yield ignores only those events.
  var onChromeOwnInput: (ChromeOwnInput?, pid_t) -> Void = { _, _ in }
  /// Writes shell-side structured Chrome diagnostics to `shell.log`.
  var onShellLog: (ShellLogWriter.Level, String, String) -> Void = { _, _, _ in }
  /// Writes paired extension `diag.batch` entries to `chrome-extension.jsonl`.
  var onExtensionDiag: (_ entries: [ChromeDiagEntry], _ profile: String, _ dropped: Int) -> Void =
    { _, _, _ in }
}

/// The shell's side of Atd for Chrome (D3, D4, D12): installs the native messaging host manifest,
/// listens on the host socket, runs one ``ChromeSession`` per connection, pairs profiles through
/// the native confirmation, keeps ``ChromePairingStore`` and site bindings, and turns requests into
/// service calls.
final class ChromeChannel {
  typealias ManifestInstaller =
    @Sendable (ChromeChannelIdentity, URL?, URL, URL) -> ChromeHostManifest.Result

  static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome")

  let identity: ChromeChannelIdentity
  let links = ChromeLinks()
  let environment: ChromeChannelEnvironment
  let pairing: ChromePairingPrompt
  var store: ChromePairingStore?
  private var listener: ChromeHostListener?
  private(set) var hostManifest: ComputerStateEvent.Chrome.HostManifest = .failed
  private(set) var installedBrowsers: [String] = []
  private var manifestInstaller: ManifestInstaller = ChromeHostManifest.install
  private var manifestHostExecutable: URL?
  private var manifestBundleURL: URL?
  private var manifestHome = FileManager.default.homeDirectoryForCurrentUser
  private var manifestRefreshEnabledForTesting = false
  private var manifestRefreshTask: Task<ChromeHostManifest.Result, Never>?
  private var manifestRefreshGeneration = 0
  private var lastManifestRefresh: ContinuousClock.Instant?
  private static let manifestRefreshCooldown: Duration = .seconds(30)
  var sessions: [ObjectIdentifier: ChromeSession] = [:]
  var diagLimiters: [ObjectIdentifier: ChromeDiagRateLimiter] = [:]
  /// The welcome and prefs each session was last sent, so a refresh sends only changes.
  private var welcomed: [ObjectIdentifier: ChromeWelcome] = [:]
  private var prefsSent: [ObjectIdentifier: ChromePrefs] = [:]
  private var observers: [any NSObjectProtocol] = []
  private var generations = 0
  /// The service's chrome bindings (every paired profile's sites), as last listed.
  var siteBindings: [TargetBindingWire.Browser] = []
  /// Runs the extension started, by run id; the projection forgets them once the service does.
  var extensionRuns: [String: ChromeExtensionRun] = [:]
  var attributedInputs = ChromeAttributionDedup()
  lazy var projection = ChromeProjection(channel: self)

  var observerCount: Int { observers.count }
  var isListenerActive: Bool { listener != nil }
  private var isManifestRefreshEnabled: Bool { listener != nil || manifestRefreshEnabledForTesting }

  init(
    identity: ChromeChannelIdentity, environment: ChromeChannelEnvironment,
    pairing: ChromePairingPrompt
  ) {
    self.identity = identity
    self.environment = environment
    self.pairing = pairing
  }

  // MARK: Lifecycle

  /// Installs the host manifest and starts listening; started with computer use. A shell without
  /// a usable socket location keeps the channel off and reports why in `computer.state`.
  func start(
    bundle: Bundle = .main,
    home: URL = FileManager.default.homeDirectoryForCurrentUser,
    locationsDirectory: URL? = nil
  ) {
    guard listener == nil else { return }
    let host = ChromeHostLocations.hostExecutable(in: bundle)
    manifestHostExecutable = host
    manifestBundleURL = bundle.bundleURL
    manifestHome = home
    let installed = manifestInstaller(identity, host, bundle.bundleURL, home)
    hostManifest = installed.status
    installedBrowsers = installed.browsers
    lastManifestRefresh = .now
    if hostManifest == .failed || hostManifest == .blockedLocation {
      logShell(
        .warn, category: "chrome-host",
        "host_manifest_\(hostManifest.rawValue) browsers=\(installedBrowsers.count)")
    }
    do {
      let bundleId = bundle.bundleIdentifier ?? ProcessInfo.processInfo.processName
      let pairingsURL =
        try locationsDirectory?.appending(path: "pairings.json", directoryHint: .notDirectory)
        ?? ChromeHostLocations.pairings(bundleId: bundleId)
      let socketURL =
        try locationsDirectory?.appending(path: "host.sock", directoryHint: .notDirectory)
        ?? ChromeHostLocations.socket(bundleId: bundleId)
      store = ChromePairingStore(url: pairingsURL)
      let listener = ChromeHostListener(socket: socketURL, hostExecutable: host)
      listener.onConnection = { [weak self] connection in self?.accept(connection) }
      try listener.start()
      self.listener = listener
    } catch {
      Self.log.error("Atd for Chrome is unavailable: \(error, privacy: .public)")
      logShell(.error, category: "chrome-host", "channel_start_failed: \(error)")
      hostManifest = .failed
      installedBrowsers = []
      environment.onStateChange()
      return
    }
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    for name in [ShellStrings.didChange, GlowEffects.didChange] {
      observers.append(
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) {
          [weak self] _ in MainActor.assumeIsolated { self?.prefsChanged() }
        })
    }
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          Task { await self.refreshHostManifests(force: false) }
        }
      })
    environment.onStateChange()
  }

  func stop() {
    manifestRefreshGeneration += 1
    manifestRefreshEnabledForTesting = false
    manifestRefreshTask?.cancel()
    manifestRefreshTask = nil
    listener?.stop()
    listener = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    for session in Array(sessions.values) { session.close() }
  }

  func configureManifestRefreshForTesting(
    bundleURL: URL, hostExecutable: URL?, home: URL, installer: @escaping ManifestInstaller
  ) {
    manifestBundleURL = bundleURL
    manifestHostExecutable = hostExecutable
    manifestHome = home
    manifestInstaller = installer
    manifestRefreshEnabledForTesting = true
  }

  /// Refreshes native messaging host manifests off the main actor. Guards `listener != nil` so a
  /// channel without a live socket never overwrites `.failed` back to `.installed`, coalesces
  /// concurrent automatic scans, and re-runs a fresh scan when `force == true` arrives mid-scan.
  func refreshHostManifests(force: Bool) async {
    guard isManifestRefreshEnabled, let bundleURL = manifestBundleURL else { return }
    if !force, manifestRefreshTask == nil, let last = lastManifestRefresh,
      ContinuousClock.now - last < Self.manifestRefreshCooldown
    {
      return
    }
    let generation = manifestRefreshGeneration
    let hadInFlight = manifestRefreshTask != nil
    var result = await coalesceOrRunManifestScan(bundleURL: bundleURL)
    guard isManifestRefreshEnabled, manifestRefreshGeneration == generation else { return }
    if force, hadInFlight {
      result = await coalesceOrRunManifestScan(bundleURL: bundleURL)
      guard isManifestRefreshEnabled, manifestRefreshGeneration == generation else { return }
    }
    lastManifestRefresh = .now
    let changed = hostManifest != result.status || installedBrowsers != result.browsers
    hostManifest = result.status
    installedBrowsers = result.browsers
    if force || changed { environment.onStateChange() }
  }

  private func coalesceOrRunManifestScan(bundleURL: URL) async -> ChromeHostManifest.Result {
    let task: Task<ChromeHostManifest.Result, Never>
    if let existing = manifestRefreshTask {
      task = existing
    } else {
      let identity = identity
      let host = manifestHostExecutable
      let home = manifestHome
      let installer = manifestInstaller
      let created = Task.detached { installer(identity, host, bundleURL, home) }
      manifestRefreshTask = created
      task = created
    }
    let result = await task.value
    if manifestRefreshTask == task { manifestRefreshTask = nil }
    return result
  }

  // MARK: State

  func welcome(_ session: ChromeSession) -> ChromeWelcome? {
    guard let hello = session.hello else { return nil }
    let paired = session.phase == .paired
    return ChromeWelcome(
      paired: paired, installationId: hello.installationId,
      label: paired ? store?.pairing(hello.installationId)?.label : nil,
      browser: session.browser,
      appVersion: environment.appVersion, prefs: environment.prefs(),
      sites: paired ? sites(of: hello.installationId) : [], hostState: environment.hostState())
  }

  func sendWelcome(_ session: ChromeSession) {
    guard let welcome = welcome(session) else { return }
    welcomed[ObjectIdentifier(session)] = welcome
    prefsSent[ObjectIdentifier(session)] = welcome.prefs
    session.send(.welcome(welcome))
  }

  func refreshWelcomes() {
    for session in sessions.values where welcomed[ObjectIdentifier(session)] != welcome(session) {
      sendWelcome(session)
    }
  }

  func prefsChanged() {
    let prefs = environment.prefs()
    for session in sessions.values where session.hello != nil {
      guard prefsSent[ObjectIdentifier(session)] != prefs else { continue }
      prefsSent[ObjectIdentifier(session)] = prefs
      session.send(.prefs(prefs))
    }
  }

  // MARK: Sessions

  private func accept(_ connection: ChromeHostConnection) {
    let session = ChromeSession(
      connection: connection, identity: identity,
      onDiagnostic: { [weak self] level, message in
        self?.logShell(level, category: "chrome", message)
      })
    sessions[ObjectIdentifier(session)] = session
    session.onFrame = { [weak self] session, frame in self?.receive(frame, from: session) }
    session.onClose = { [weak self] session in self?.ended(session) }
  }

  private func ended(_ session: ChromeSession) {
    let key = ObjectIdentifier(session)
    sessions[key] = nil
    diagLimiters[key] = nil
    welcomed[key] = nil
    prefsSent[key] = nil
    if let link = session.link { disconnect(link) }
    session.link = nil
  }

  func link(_ session: ChromeSession, _ hello: ChromeHello) {
    let label = Self.label(of: hello, browser: session.browser)
    store?.seen(
      hello.installationId, label: label, email: hello.profile.email, browser: session.browser,
      browserIdentity: session.browserIdentity)
    for other in sessions.values where other !== session && other.link != nil {
      if other.installationId == hello.installationId { other.close() }
    }
    generations += 1
    let link = ChromeLink(
      installationId: hello.installationId, generation: generations,
      browserPid: session.browserPid, chromeVersion: hello.chromeVersion,
      fileAccess: hello.fileAccess, label: label,
      send: { [weak session] frame in session?.send(frame) })
    session.paired(link)
    link.onTabsChange = { [weak self] link in self?.projection.tabsChanged(link) }
    links.add(link)
    logShell(
      .info, category: "chrome",
      "session_linked profile=\(Self.profileHash(of: hello.installationId)) browser=\(session.browser)"
    )
    environment.onStateChange()
    sendWelcome(session)
    projection.linkConnected(link)
  }

  private func disconnect(_ link: ChromeLink) {
    links.remove(link)
    logShell(
      .info, category: "chrome",
      "session_disconnected profile=\(Self.profileHash(of: link.installationId))")
    environment.onStateChange()
  }

  private func receive(_ frame: ChromeInboundFrame, from session: ChromeSession) {
    switch session.phase {
    case .paired: handlePaired(frame, from: session)
    case .unpaired: handleUnpaired(frame, from: session)
    case .awaitingHost, .checkingBrowser, .awaitingHello, .closed: break
    }
  }

  func sites(of installationId: String) -> [String] {
    siteBindings.filter { $0.profileId == installationId }.compactMap(\.allowedOrigins.first)
  }

  func session(of installationId: String) -> ChromeSession? {
    sessions.values.first { $0.link?.installationId == installationId }
  }
}
