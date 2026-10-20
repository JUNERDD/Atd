import AICore
import AppKit
import Darwin

/// One running managed Chrome: the browser process of a profile and the DevTools endpoint it
/// bound (port and browser target path, verified against `/json/version`). `pid` and `start`
/// (the process start time) identify the process, so a reused pid never matches; they form the
/// `contextId` of the profile's target refs.
struct ManagedChromeInstance: Equatable, Sendable {
  let profileId: String
  let pid: pid_t
  let start: UInt64
  let port: Int
  let browserPath: String

  var contextId: String { "\(pid)-\(start)" }

  /// The verified browser websocket the worker connects to (`ws://127.0.0.1:<port>/devtools/…`).
  var webSocketURL: String { "ws://127.0.0.1:\(port)\(browserPath)" }
}

enum ManagedChromeError: LocalizedError, Equatable {
  /// Google Chrome is not installed (no app with its bundle id).
  case missing
  case launchFailed(String)
  /// Chrome started but published no DevTools endpoint the host could verify.
  case endpointMissing

  var errorDescription: String? {
    switch self {
    case .missing: "Google Chrome is not installed."
    case .launchFailed(let detail): "Google Chrome did not start: \(detail)"
    case .endpointMissing: "Google Chrome started without a usable DevTools endpoint."
    }
  }
}

/// The managed Chrome processes, one per profile (D16). A browser comes forward only for a person
/// who asked for it (``openAttended(profileId:url:)``: adding a website and signing in, signing in
/// again), which also brings back a window a run parked. A run never does: it gives a website's
/// page a background tab of the browser that already runs (``openInBackground(_:)``), and starts a
/// browser that does not run, or has no window, by ``launchWithoutWindow(profileId:)`` and a
/// parked background window (``openFirstPage(for:running:)``). That start is the shell running the
/// Chrome executable itself and opening no window at launch: a LaunchServices start is no
/// alternative, since on macOS 26 with Chrome 155 a launch with a window activated Chrome even
/// when LaunchServices was told not to (`activates = false`, also with `hides`), and opening the
/// first tab of a windowless launch activated it too.
///
/// A browser keeps running when the shell quits, so the next shell adopts it: the profile's
/// `SingletonLock` names its pid, the process must be this Chrome's executable, and its
/// `DevToolsActivePort` must name the browser `/json/version` reports on that port. Both starts
/// leave exactly that, so a browser started by a run is adopted like any other.
final class ManagedChromes {
  let profiles: ManagedBrowserProfiles
  private let workspace: NSWorkspace
  private var instances: [String: ManagedChromeInstance] = [:]
  /// The browsers the shell started itself as child processes, kept until they exit so each is
  /// reaped.
  private var children: [String: Process] = [:]
  /// The worker pool that opens pages (``openInBackground(_:)``); the engine that owns it sets it
  /// when it is created, since browsers and workers are built apart.
  var workers: BrowserWorkerPool?
  /// The latest background opening of each profile, so openings of one profile run in turn.
  var openings: [String: Task<Void, Never>] = [:]
  /// The bindings whose background opening was refused with `openBrowser`, oldest first: the
  /// person's "Open browser" finds a run-only binding here, which the service lists nowhere.
  var refusedOpenings: [TargetBindingWire.Browser] = []

  init(profiles: ManagedBrowserProfiles, workspace: NSWorkspace = .shared) {
    self.profiles = profiles
    self.workspace = workspace
  }

  /// The installed Google Chrome, or nil.
  var applicationURL: URL? {
    workspace.urlForApplication(withBundleIdentifier: ManagedChromeLaunch.bundleIdentifier)
  }

  var version: String? {
    applicationURL.flatMap {
      Bundle(url: $0)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }
  }

  /// The profile's browser as last seen, if its process still runs.
  func tracked(_ profileId: String) -> ManagedChromeInstance? {
    guard let instance = instances[profileId] else { return nil }
    guard ProcessIdentity.start(of: instance.pid) == instance.start else {
      instances[profileId] = nil
      return nil
    }
    return instance
  }

  /// The profile's running browser: tracked, or adopted from an earlier shell.
  func running(_ profileId: String) async -> ManagedChromeInstance? {
    if let tracked = tracked(profileId) { return tracked }
    guard let profile = profiles.locate(profileId),
      let instance = await adopt(profileId: profileId, profile: profile)
    else { return nil }
    instances[profileId] = instance
    return instance
  }

  /// Opens `url` in the profile's browser for the person, starting it when it is not running,
  /// and brings it forward. Only a person's own request may call this (adding a website, signing
  /// in again): it is the one headed, activating entry, and no run uses it.
  func openAttended(profileId: String, url: String) async throws(ManagedChromeError)
    -> ManagedChromeInstance
  {
    guard let app = applicationURL else { throw .missing }
    guard let profile = profiles.locate(profileId) else {
      throw .launchFailed("the browser profile \(profileId) does not exist")
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    configuration.createsNewApplicationInstance = true
    configuration.addsToRecentItems = false
    configuration.arguments = ManagedChromeLaunch.arguments(profile: profile, startUrl: url)
    if let existing = await running(profileId) {
      // A window a run parked beyond the displays comes back first, so the person finds the
      // browser on screen, and the URL below opens in it.
      await restoreParkedWindows(existing)
      // The second process hands the URL to the profile's running browser and exits.
      _ = try? await workspace.openApplication(at: app, configuration: configuration)
      NSRunningApplication(processIdentifier: existing.pid)?.activate()
      return existing
    }
    try? FileManager.default.removeItem(at: Self.portFile(profile))
    let launched: NSRunningApplication
    do {
      launched = try await workspace.openApplication(at: app, configuration: configuration)
    } catch {
      throw .launchFailed(error.localizedDescription)
    }
    let pid = launched.processIdentifier
    guard let instance = await waitForEndpoint(profileId: profileId, profile: profile, pid: pid)
    else {
      if let start = ProcessIdentity.start(of: pid) { await Self.stop(pid: pid, start: start) }
      throw .endpointMissing
    }
    instances[profileId] = instance
    return instance
  }

  /// Starts the profile's browser for a run, with no person at the screen (plan §7, method A,
  /// verified by the S8 probe on an unlocked session): the Chrome executable runs as a child of
  /// the shell, not through LaunchServices, and opens no window
  /// (``ManagedChromeLaunch/backgroundArguments(profile:)``). It gets an environment of its own,
  /// like the browser worker: nothing of the shell's reaches a third-party browser. Returns once
  /// the DevTools endpoint is verified, so ``adopt(profileId:profile:)`` finds this browser by
  /// its lock and executable like any other.
  func launchWithoutWindow(profileId: String) async throws(ManagedChromeError)
    -> ManagedChromeInstance
  {
    guard let executable = applicationURL.flatMap({ Bundle(url: $0)?.executableURL }) else {
      throw .missing
    }
    guard let profile = profiles.locate(profileId) else {
      throw .launchFailed("the browser profile \(profileId) does not exist")
    }
    try? FileManager.default.removeItem(at: Self.portFile(profile))
    let process = Process()
    process.executableURL = executable
    process.arguments = ManagedChromeLaunch.backgroundArguments(profile: profile)
    process.environment = Self.childEnvironment()
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    process.terminationHandler = { [weak self] ended in
      let pid = ended.processIdentifier
      Task { @MainActor in
        if self?.children[profileId]?.processIdentifier == pid { self?.children[profileId] = nil }
      }
    }
    do {
      try process.run()
    } catch {
      throw .launchFailed(error.localizedDescription)
    }
    // A process that is already gone (it handed its work to a running browser) is not kept.
    children[profileId] = process.isRunning ? process : nil
    let pid = process.processIdentifier
    guard let instance = await waitForEndpoint(profileId: profileId, profile: profile, pid: pid)
    else {
      if let start = ProcessIdentity.start(of: pid) { await Self.stop(pid: pid, start: start) }
      throw .endpointMissing
    }
    instances[profileId] = instance
    return instance
  }

  /// What a browser started by the shell needs: where the person's home is, a place for
  /// temporary files, the locale, and a plain `PATH`.
  private static func childEnvironment() -> [String: String] {
    let inherited = ProcessInfo.processInfo.environment
    var environment = [
      "HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(),
      "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    ]
    for key in ["TMPDIR", "LANG", "LC_ALL", "__CF_USER_TEXT_ENCODING"] {
      if let value = inherited[key] { environment[key] = value }
    }
    return environment
  }

  /// Quits the profile's browser (an abandoned preparation).
  func quit(_ profileId: String) async {
    guard let instance = tracked(profileId) else { return }
    instances[profileId] = nil
    await Self.stop(pid: instance.pid, start: instance.start)
  }

  func quitAll() async {
    for profileId in Array(instances.keys) { await quit(profileId) }
  }

  // MARK: Endpoint

  private func waitForEndpoint(profileId: String, profile: URL, pid: pid_t) async
    -> ManagedChromeInstance?
  {
    let deadline = ContinuousClock.now.advanced(by: .seconds(20))
    while ContinuousClock.now < deadline {
      guard let start = ProcessIdentity.start(of: pid) else { return nil }
      if let port = Self.readPort(profile), await Self.verify(port) {
        return ManagedChromeInstance(
          profileId: profileId, pid: pid, start: start, port: port.port,
          browserPath: port.browserPath)
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return nil
  }

  private func adopt(profileId: String, profile: URL) async -> ManagedChromeInstance? {
    let lock = profile.appending(path: ManagedChromeLaunch.singletonLock).path(
      percentEncoded: false)
    guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: lock),
      let pid = ManagedChromeLaunch.lockOwner(target),
      let executable = applicationURL.flatMap({ Bundle(url: $0)?.executableURL }),
      ProcessIdentity.executablePath(of: pid) == executable.resolvingSymlinksInPath().path,
      let start = ProcessIdentity.start(of: pid),
      let port = Self.readPort(profile), await Self.verify(port)
    else { return nil }
    return ManagedChromeInstance(
      profileId: profileId, pid: pid, start: start, port: port.port, browserPath: port.browserPath)
  }

  private static func portFile(_ profile: URL) -> URL {
    profile.appending(path: ManagedChromeLaunch.activePortFile, directoryHint: .notDirectory)
  }

  private static func readPort(_ profile: URL) -> DevToolsActivePort? {
    (try? String(contentsOf: portFile(profile), encoding: .utf8)).flatMap {
      DevToolsActivePort(contents: $0)
    }
  }

  /// Loopback only and never through a proxy.
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.connectionProxyDictionary = [:]
    configuration.timeoutIntervalForRequest = 2
    return URLSession(configuration: configuration)
  }()

  /// Whether the port serves the browser the file names.
  private static func verify(_ port: DevToolsActivePort) async -> Bool {
    struct Version: Decodable { let webSocketDebuggerUrl: String }
    guard let url = port.versionURL,
      let (data, _) = try? await session.data(from: url),
      let version = try? JSONDecoder().decode(Version.self, from: data)
    else { return false }
    return port.matches(webSocketDebuggerUrl: version.webSocketDebuggerUrl)
  }

  /// Asks the browser to quit, then escalates to SIGTERM and SIGKILL.
  private static func stop(pid: pid_t, start: UInt64) async {
    let alive = { ProcessIdentity.start(of: pid) == start }
    NSRunningApplication(processIdentifier: pid)?.terminate()
    for (limit, signal) in [(Duration.seconds(5), SIGTERM), (.seconds(3), SIGKILL)] {
      let deadline = ContinuousClock.now.advanced(by: limit)
      while alive(), ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(100))
      }
      guard alive() else { return }
      kill(pid, signal)
    }
  }
}

/// A process's identity as the kernel reports it.
nonisolated enum ProcessIdentity {
  /// The start time in microseconds since 1970, or nil when no such process runs.
  static func start(of pid: pid_t) -> UInt64? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    return UInt64(info.pbi_start_tvsec) * 1_000_000 + UInt64(info.pbi_start_tvusec)
  }

  static func executablePath(of pid: pid_t) -> String? {
    var buffer = [UInt8](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    let path = String(decoding: buffer.prefix(Int(length)), as: UTF8.self)
    return URL(filePath: path).resolvingSymlinksInPath().path
  }
}
