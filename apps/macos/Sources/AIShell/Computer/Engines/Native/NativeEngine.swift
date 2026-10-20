import AIComputerDriverKit
import AICore
import AppKit
import OSLog

/// The native engine `atd` (D13, plan §4.2): applications driven in the background through the
/// app's own driver helper, `atd-computer-driver`, which the shell spawns as a direct child
/// (``DriverClient``). It resolves a binding to the exact process and its root window (the app's
/// main window, never a choice asked of the person), lists the surfaces that belong to it,
/// observes a surface's accessibility tree and pixels, and sends each step down the route ladder
/// (``NativeRoutePlan``): accessibility first, wherever the window is (another Space and a
/// full-screen Space included), window-routed events only on the active Space and where the
/// toolkit takes them, never the foreground. A step with no such route is refused
/// `noBackgroundRoute` with its reason. The one app it starts is an application target that is not running, without
/// activating it (``launchInBackground(_:_:until:)``).
///
/// Lifecycle: the driver starts on demand. It stops after ``Configuration/idleGrace`` without
/// calls only once every ref it resolved has been released (``releaseTarget(_:)``), so a person
/// who takes a while over a step Atd refused comes back to refs that still work. Every start is
/// a new generation (stamped into the driver's events, plan I8); a driver that exits on its own
/// ends its generation and every ref of it, and the next request starts a new one. Repeated
/// start failures back off.
final class NativeEngine: ComputerEngine {
  struct Configuration {
    /// The embedded helper (``DriverLaunch/bundled(_:)``); nil when this build has none.
    var driver: URL?
    /// Where the driver's stderr goes.
    var log: URL
    /// How long the driver runs without calls once no ref it resolved is held.
    var idleGrace: Duration = .seconds(300)
    var startTimeout: Duration = .seconds(10)
    /// The event-rung defaults (``NativeRoutePolicy``), which the probe verdicts adjust.
    var routes: NativeRoutePolicy = .standard
  }

  static let unqualifiedEvidence =
    "Background accessibility actions and window-routed input through Atd's own driver; the "
    + "probe verdicts and unattended application control remain unqualified."

  let id = ComputerEngineID.atd
  let profile = NativeEngine.makeProfile()
  /// Built into the app: the helper ships in the bundle, no add-on installs it.
  let isInstalled = true
  private(set) var generation: Int?
  let configuration: Configuration
  var targets: [String: Target] = [:]
  /// The id of the driver's newest snapshot of each window (``NativeSurfaceRead/windowKey``),
  /// whichever target read it: a newer snapshot of a window stales the tokens of the older.
  var snapshots: [String: String] = [:]
  /// The driver capabilities available in this generation (``DriverCapabilityName``): those
  /// `hello` reported, less any the driver reported latched off since.
  private(set) var capabilities: Set<String> = []
  /// Windows the driver pinned visible (``NativeSurfaceRead/windowKey``), with the target refs
  /// that need them; a window is released once no ref does.
  var pinned: [String: Set<String>] = [:]
  /// Processes the driver asked to turn web accessibility on, whatever came of it. It stays on
  /// for the life of the process, whichever generation of the driver asked (toggling it has
  /// effects), so each process is asked once.
  var webAccessibility: Set<NativeProcessKey> = []
  /// Routes the disturbance guard demoted, with how long each stays off (``RouteDemotion``). Keyed
  /// by the app rather than a ref, they outlive the driver's generation: a strike is kept until
  /// Atd quits, never cleared by the driver's idle stop, so a second one is always counted.
  var demotions: [NativeDemotion: RouteDemotion] = [:]
  /// Operations the coordinator cancelled, and how to cancel each one's request in flight.
  var stopping: Set<String> = []
  var cancels: [String: () -> Void] = [:]
  private(set) lazy var client = DriverClient { [weak self] ended in
    Task { @MainActor in self?.driverExited(ended) }
  }
  private var driverProcess: pid_t?
  /// The newest generation number given out, so a new start numbers on from it.
  private var lastGeneration = 0
  var activeCalls = 0
  private var idleTimer: Task<Void, Never>?
  private var startFailures = 0
  private var retryAfter: ContinuousClock.Instant?
  static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  init(configuration: Configuration) {
    self.configuration = configuration
  }

  /// No add-on carries this engine.
  func install(_ binaries: EngineBinaries) -> Bool { false }

  /// What the engine offers: background delivery only, input that never touches the system's
  /// shared pointer or keyboard, and native targets; each target's capabilities list the routes
  /// its toolkit takes. Unattended runs need a qualified profile, which this is not yet.
  static func makeProfile() -> CapabilityProfileWire {
    let system = ProcessInfo.processInfo.operatingSystemVersion
    let version =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    #if arch(arm64)
      let arch = CapabilityProfileWire.Arch.arm64
    #else
      let arch = CapabilityProfileWire.Arch.x8664
    #endif
    return CapabilityProfileWire(
      engine: .atd, engineVersion: "\(version) (driver protocol \(driverProtocolVersion))",
      os: "macOS \(system.majorVersion).\(system.minorVersion).\(system.patchVersion)",
      arch: arch, targetKinds: [.native],
      actions: [.setValue, .press, .wait, .click, .key, .type, .clear, .menu, .scroll, .drag],
      effects: [.read, .input, .click, .invoke, .submit], delivery: [.background],
      affectsSystemInput: false, qualification: .unqualified, evidence: unqualifiedEvidence)
  }

  // MARK: Lifecycle

  func start() async throws {
    if generation != nil, await client.processIdentifier != nil { return }
    if let retryAfter, ContinuousClock.now < retryAfter {
      throw StartError(
        "The computer-use driver failed to start recently; it is tried again shortly.")
    }
    guard let executable = configuration.driver,
      FileManager.default.isExecutableFile(atPath: executable.path(percentEncoded: false))
    else { throw StartError("This build has no \(DriverLaunch.executableName) helper.") }
    resetGeneration(nil)
    lastGeneration += 1
    let next = lastGeneration
    do throws(DriverClientFailure) {
      let hello = try await client.start(
        DriverLaunch(executable: executable, log: configuration.log, generation: next),
        timeout: configuration.startTimeout)
      guard hello.protocolVersion == driverProtocolVersion else {
        await client.stop()
        throw .launch(
          "The driver speaks protocol \(hello.protocolVersion), not \(driverProtocolVersion).")
      }
      for capability in hello.capabilities where !capability.available {
        Self.log.notice(
          "Driver capability \(capability.name, privacy: .public) is off: \(capability.detail ?? "", privacy: .public)"
        )
      }
      capabilities = Set(hello.capabilities.filter(\.available).map(\.name))
      driverProcess = await client.processIdentifier
      generation = next
      startFailures = 0
      retryAfter = nil
      scheduleIdleStop()
    } catch {
      startFailures += 1
      retryAfter = .now + .seconds(min(60, 1 << min(startFailures, 6)))
      throw StartError(Self.describe(error))
    }
  }

  func shutdown() async {
    idleTimer?.cancel()
    idleTimer = nil
    for cancel in cancels.values { cancel() }
    resetGeneration(nil)
    await client.stop()
  }

  /// The driver exited on its own: its generation and every ref of it are gone, and the next
  /// request starts a new one.
  func driverExited(_ ended: Int) {
    guard generation == ended else { return }
    Self.log.error("The computer-use driver of generation \(ended) exited.")
    resetGeneration(nil)
  }

  func resetGeneration(_ running: Int?) {
    generation = running
    targets = [:]
    snapshots = [:]
    pinned = [:]
    // Web accessibility outlives the driver; only processes that ended are forgotten.
    webAccessibility = webAccessibility.filter {
      NativeTargetProbe.processStart(pid: pid_t($0.pid)) == $0.start
    }
    capabilities = []
    driverProcess = nil
  }

  /// The driver answered that `capability` is off although `hello` reported it on: it latched it
  /// off after a failed call, for the rest of its process. The host stops asking for it.
  func driverTurnedOff(_ capability: String) {
    guard capabilities.remove(capability) != nil else { return }
    Self.log.notice(
      "Driver capability \(capability, privacy: .public) is off: latched off at runtime in generation \(self.generation ?? 0); no longer asked for"
    )
  }

  /// Stops the driver once no call ran for the idle grace and no ref it resolved is held; the
  /// release of the last held ref arms the timer again.
  func scheduleIdleStop() {
    idleTimer?.cancel()
    let grace = configuration.idleGrace
    idleTimer = Task { [weak self] in
      try? await Task.sleep(for: grace)
      guard !Task.isCancelled, let self, self.activeCalls == 0, self.generation != nil,
        !self.holdsRefs
      else { return }
      await self.shutdown()
    }
  }

  /// Whether a ref of this generation that the coordinator has not released still names its
  /// target; such a ref keeps the driver running.
  var holdsRefs: Bool { targets.values.contains { !$0.released } }

  // MARK: Coordinator hooks

  func cancel(operationId: String) async {
    stopping.insert(operationId)
    cancels[operationId]?()
  }

  func resources(for ref: TargetRefWire) -> Set<DeviceResource> {
    guard let native = ref.native, let start = UInt64(native.processStart) else { return [] }
    return [.process(pid: Int32(native.pid), start: start)]
  }

  var inputProcesses: Set<pid_t> { driverProcess.map { [$0] } ?? [] }

  struct StartError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
  }

  static func describe(_ failure: DriverClientFailure) -> String {
    switch failure {
    case .launch(let message), .malformed(let message): message
    case .refused(let refusal): refusal.message ?? refusal.code.rawValue
    case .notRunning, .exited: "The computer-use driver exited."
    case .timedOut: "The computer-use driver did not answer in time."
    case .cancelled: "The request to the computer-use driver was cancelled."
    }
  }
}

/// A route the guard demoted (plan §4.2): keyed by what decides how the app takes input, its
/// bundle, version and toolkit, so a relaunch or a second window of the same app stays demoted
/// for as long as the demotion lasts (``RouteDemotion``).
struct NativeDemotion: Hashable {
  let bundleId: String
  let appVersion: String
  let toolkit: DriverToolkit
  let route: ActionResultWire.Route
  let kind: ComputerStepKind
}

/// One process, by pid and start time (``NativeTargetProbe/processStart(pid:)``), so a reused pid
/// never stands for the process before it.
struct NativeProcessKey: Hashable {
  let pid: Int
  let start: UInt64

  /// The process running as `pid` now; nil when none does.
  static func running(_ pid: Int) -> NativeProcessKey? {
    NativeTargetProbe.processStart(pid: pid_t(pid)).map { NativeProcessKey(pid: pid, start: $0) }
  }
}
