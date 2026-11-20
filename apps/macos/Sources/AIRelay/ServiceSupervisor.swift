import AICore
import Darwin
import Foundation

/// Release: runs the bundled service as a child process and keeps it running (decision Q10).
///
/// - Start: a service already serving the data directory is reused only when it runs this
///   very build AND its kernel executable path (`ProcessIdentity.executablePath(of:)`,
///   `resolvingSymlinksInPath()`) resides inside this bundle's allowed root; otherwise it is
///   stopped and a new one spawned with `--login-shell-path`.
/// - A failed first start is shown (``ServiceUnavailable/failed(_:)``), not retried.
/// - An unexpected exit restarts it after the ``SupervisorPolicy`` backoff (500 ms doubling to
///   15 s); three within five minutes open the circuit (``ServiceUnavailable/stoppedTooOften``)
///   while retaining ``lastFailureSummary`` until a manual ``restart()`` reaches `.running`.
/// - ``stop()`` (quit) asks the service to shut down, then kills it if it does not exit
///   (``ServiceStopper``).
///
/// Every intentional transition bumps a generation; exits, timers and spawns of an older one are
/// ignored, which is what keeps quit and restart from respawning.
public final class ServiceSupervisor: ServiceEndpointSource {
  public enum State: Equatable, Sendable {
    case idle
    case starting
    case running(ServiceEndpoint)
    /// Waiting out the backoff after an unexpected exit, or respawning.
    case restarting
    case unavailable(ServiceUnavailable)
  }

  /// How long a request or connection waits for a starting service before it is refused.
  public static let startupWait: Duration = .seconds(5)
  /// Liveness poll for a reused service, which has no exit notification.
  static let adoptedPoll: Duration = .seconds(1)
  private static let maxRecentExits = 10

  public let plan: ServiceLaunchPlan
  public let logDirectory: URL
  public let allowedExecutableRoot: URL
  public private(set) var lastFailureSummary: String?
  public private(set) var recentExits: [ServiceProcessExitRecord] = []
  public var decisionRing: RelayAndSupervisorRing?
  public private(set) var state: State = .idle {
    didSet {
      guard state != oldValue else { return }
      onStateChange?(state)
      endpointMayHaveChanged?()
    }
  }
  public var onStateChange: (@MainActor (State) -> Void)?
  public var endpointMayHaveChanged: (@MainActor () -> Void)?

  private var policy = SupervisorPolicy(clock: ContinuousClock())
  private var generation = 0
  private var child: ServiceProcess?
  private var watcher: Task<Void, Never>?
  private let ready = BoundedWaiters<ServiceEndpoint>()
  private let executablePathProvider: @Sendable (pid_t) -> String?
  private var clearFailureOnNextLive = false

  /// - Parameters:
  ///   - plan: the bundled Node, service and data directory.
  ///   - logDirectory: where `service.log` and its rotations go, `~/Library/Logs/<app>`.
  ///   - bundleURL: optional explicit app bundle root for cross-path adoption verification;
  ///     defaults to the `.app` root enclosing `plan.node` (or `Resources` in standalone tests).
  public init(
    plan: ServiceLaunchPlan,
    logDirectory: URL,
    bundleURL: URL? = nil,
    decisionRing: RelayAndSupervisorRing? = nil
  ) {
    self.plan = plan
    self.logDirectory = logDirectory
    self.allowedExecutableRoot = bundleURL ?? Self.resolveExpectedBundleRoot(for: plan)
    self.decisionRing = decisionRing
    self.executablePathProvider = ProcessIdentity.executablePath(of:)
  }

  init(
    plan: ServiceLaunchPlan,
    logDirectory: URL,
    bundleURL: URL? = nil,
    decisionRing: RelayAndSupervisorRing? = nil,
    executablePathProvider: @escaping @Sendable (pid_t) -> String?
  ) {
    self.plan = plan
    self.logDirectory = logDirectory
    self.allowedExecutableRoot = bundleURL ?? Self.resolveExpectedBundleRoot(for: plan)
    self.decisionRing = decisionRing
    self.executablePathProvider = executablePathProvider
  }

  public func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    switch state {
    case .running(let endpoint):
      return .success(endpoint)
    case .idle, .starting, .restarting:
      if let endpoint = await ready.wait(atMost: Self.startupWait) { return .success(endpoint) }
      if case .unavailable(let reason) = state { return .failure(reason) }
      return .failure(.starting)
    case .unavailable(let reason):
      return .failure(reason)
    }
  }

  /// Brings the service up: reuse the running one of this build and bundle path, or replace it.
  public func start() async {
    let generation = invalidate()
    state = .starting
    let bundled = (try? Data(contentsOf: plan.buildInfo)).flatMap(ServiceLaunchPlan.parseBuildInfo)
    if case .success(let running) = ServiceDiscovery.read(dataDirectory: plan.dataDirectory),
      ServiceLaunchPlan.canReuse(running: running.buildId, bundled: bundled)
    {
      let runningExec = executablePathProvider(running.pid)
      let sameBundle = ProcessIdentity.isExecutable(runningExec, inside: allowedExecutableRoot)
      if sameBundle,
        (try? await ShellClient(endpoint: running).status())?.service.serviceId == running.serviceId
      {
        guard generation == self.generation else { return }
        RelayLog.service.info("Reusing the running service (pid \(running.pid)).")
        recordRing(
          eventKind: 1, outcome: 0, pid: running.pid, epoch: Int32(running.epoch), flags: 1,
          detail: "adopted_running_service")
        return live(running, generation: generation, adopted: true)
      }
      if !sameBundle {
        RelayLog.service.warning("Refusing cross-path service adoption (pid \(running.pid)).")
        recordRing(
          eventKind: 1, outcome: 2, pid: running.pid, epoch: Int32(running.epoch), flags: 4,
          detail: "rejected_foreign_bundle_service")
      }
    }
    // Nothing is supervised yet, so replacing a stale or foreign process never counts as a crash.
    await ServiceStopper.stop(dataDirectory: plan.dataDirectory)
    guard generation == self.generation else { return }
    do {
      try await spawn(generation: generation)
    } catch {
      guard generation == self.generation else { return }
      let scrubbed = DiagnosticsScrubber.scrubInlineSummary(
        error.localizedDescription, maxUTF8Bytes: 170)
      let summary = scrubbed.isEmpty ? "The agent service failed to start." : scrubbed
      lastFailureSummary = summary
      RelayLog.service.error("The service did not start: \(summary, privacy: .public)")
      recordRing(eventKind: 2, outcome: 2, pid: 0, epoch: 0, flags: 0, detail: summary)
      fail(.failed(summary))
    }
  }

  /// Manual restart (menu): forgets the crash history, stops the service, starts a new one, and
  /// clears ``lastFailureSummary`` once the new instance reaches `.running`.
  public func restart() async {
    policy.reset()
    clearFailureOnNextLive = true
    await stopService()
    await start()
  }

  /// Quit: ends supervision and stops the service; never respawns.
  public func stop() async {
    clearFailureOnNextLive = false
    await stopService()
    fail(.stopped)
  }

  private func stopService() async {
    invalidate()
    state = .restarting
    let spawned = child
    child = nil
    await ServiceStopper.stop(dataDirectory: plan.dataDirectory)
    // A child that never published its endpoint cannot be asked to shut down.
    if let spawned, spawned.isRunning {
      spawned.process.terminate()
      await ServiceStopper.ensureExit(spawned.pid)
    }
  }

  @discardableResult
  private func invalidate() -> Int {
    generation += 1
    watcher?.cancel()
    watcher = nil
    child?.onExit = nil
    return generation
  }

  private func spawn(generation: Int) async throws {
    let process = try ServiceProcess.launch(plan, logDirectory: logDirectory)
    child = process
    let endpoint = try await process.waitForEndpoint(dataDirectory: plan.dataDirectory)
    guard generation == self.generation else { return }
    process.onExit = { [weak self] exit in
      self?.recordProcessExit(exit)
      let message = exit.failureDetail ?? "The service (pid \(process.pid)) \(exit.description)"
      self?.unexpectedExit(generation, message)
    }
    if !process.isRunning {
      return unexpectedExit(generation, "The service (pid \(process.pid)) exited at startup")
    }
    RelayLog.service.info("The service is running (pid \(endpoint.pid)).")
    live(endpoint, generation: generation, adopted: false)
  }

  private func live(_ endpoint: ServiceEndpoint, generation: Int, adopted: Bool) {
    policy.serviceBecameLive()
    if clearFailureOnNextLive {
      lastFailureSummary = nil
      clearFailureOnNextLive = false
    }
    state = .running(endpoint)
    ready.resumeAll(with: endpoint)
    guard adopted else { return }
    watcher = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.adoptedPoll)
        guard !Task.isCancelled else { return }
        if !isProcessAlive(endpoint.pid) {
          self?.unexpectedExit(generation, "The reused service (pid \(endpoint.pid)) is gone")
          return
        }
      }
    }
  }

  private func unexpectedExit(_ generation: Int, _ reason: String) {
    guard generation == self.generation else { return }
    watcher?.cancel()
    watcher = nil
    child = nil
    let scrubbed = DiagnosticsScrubber.scrubInlineSummary(reason, maxUTF8Bytes: 170)
    if !scrubbed.isEmpty { lastFailureSummary = scrubbed }

    switch policy.unexpectedExit() {
    case .giveUp:
      RelayLog.service.error(
        "\(scrubbed, privacy: .public). Three unexpected exits in five minutes; giving up.")
      recordRing(eventKind: 4, outcome: 3, pid: 0, epoch: 0, flags: 0, detail: scrubbed)
      invalidate()
      fail(.stoppedTooOften)
    case .restart(let delay):
      RelayLog.service.error("\(scrubbed, privacy: .public). Restarting in \(delay).")
      recordRing(eventKind: 3, outcome: 1, pid: 0, epoch: 0, flags: 0, detail: scrubbed)
      state = .restarting
      watcher = Task { [weak self] in
        try? await Task.sleep(for: delay)
        guard let self, !Task.isCancelled, generation == self.generation else { return }
        // An earlier attempt may have left a process that started but never connected.
        await ServiceStopper.stop(dataDirectory: plan.dataDirectory)
        guard generation == self.generation else { return }
        do {
          try await spawn(generation: generation)
        } catch {
          unexpectedExit(generation, "The restart failed: \(error.localizedDescription)")
        }
      }
    }
  }

  private func fail(_ reason: ServiceUnavailable) {
    state = .unavailable(reason)
    ready.resumeAll(with: nil)
  }

  private func recordProcessExit(_ exit: ServiceProcess.ExitSummary) {
    let nowIso = Date().formatted(
      .iso8601.year().month().day().time(includingFractionalSeconds: true))
    let summary = DiagnosticsScrubber.scrubInlineSummary(
      exit.failureDetail ?? exit.description, maxUTF8Bytes: 170)
    recentExits.append(
      ServiceProcessExitRecord(
        recordedAt: nowIso,
        terminationStatus: exit.status,
        uncaughtSignal: exit.uncaughtSignal,
        summary: summary))
    if recentExits.count > Self.maxRecentExits {
      recentExits.removeFirst(recentExits.count - Self.maxRecentExits)
    }
  }

  private func recordRing(
    eventKind: UInt8, outcome: UInt8, pid: Int32, epoch: Int32, flags: UInt8, detail: String
  ) {
    guard let decisionRing else { return }
    var entry = RelayAndSupervisorEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.subsystem = 1
    entry.eventKind = eventKind
    entry.outcome = outcome
    entry.pid = pid
    entry.epoch = epoch
    entry.flags = flags
    entry.detail = InlineText64(truncatingUTF8: detail)
    decisionRing.append(entry)
  }

  private static func resolveExpectedBundleRoot(for plan: ServiceLaunchPlan) -> URL {
    let resources = plan.node.deletingLastPathComponent().deletingLastPathComponent()
    let contents = resources.deletingLastPathComponent()
    if resources.lastPathComponent == "Resources" && contents.lastPathComponent == "Contents" {
      return contents.deletingLastPathComponent()
    }
    return resources
  }
}
