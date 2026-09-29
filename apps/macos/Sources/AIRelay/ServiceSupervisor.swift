import AICore
import Foundation

/// Release: runs the bundled service as a child process and keeps it running (decision Q10,
/// mirroring `autostart.ts` and `supervisor.ts`).
///
/// - Start: a service already serving the data directory is reused only when it runs this
///   very build; otherwise it is stopped and a new one spawned with `--login-shell-path`.
/// - A failed first start is shown (``ServiceUnavailable/failed(_:)``), not retried.
/// - An unexpected exit restarts it after the ``SupervisorPolicy`` backoff (500 ms doubling to
///   15 s); three within five minutes open the circuit (``ServiceUnavailable/stoppedTooOften``)
///   until ``restart()``.
/// - ``stop()`` (quit) asks the service to shut down, then sends SIGTERM if it does not go.
///
/// Every intentional transition bumps a generation; exits, timers and spawns of an older one are
/// ignored, which is what keeps quit and restart from respawning.
@MainActor
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

  public let plan: ServiceLaunchPlan
  public let logDirectory: URL
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

  /// - Parameters:
  ///   - plan: the bundled Node, service and data directory.
  ///   - logDirectory: where `service.log` and its rotations go, `~/Library/Logs/<app>`.
  public init(plan: ServiceLaunchPlan, logDirectory: URL) {
    self.plan = plan
    self.logDirectory = logDirectory
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

  /// Brings the service up: reuse the running one of this build, or replace it.
  public func start() async {
    let generation = invalidate()
    state = .starting
    let bundled = (try? Data(contentsOf: plan.buildInfo)).flatMap(ServiceLaunchPlan.parseBuildInfo)
    if case .success(let running) = ServiceDiscovery.read(dataDirectory: plan.dataDirectory),
      ServiceLaunchPlan.canReuse(running: running.buildId, bundled: bundled),
      (try? await ShellClient(endpoint: running).status())?.service.serviceId == running.serviceId
    {
      guard generation == self.generation else { return }
      RelayLog.service.info("Reusing the running service (pid \(running.pid)).")
      return live(running, generation: generation, adopted: true)
    }
    // Nothing is supervised yet, so replacing a stale process never counts as a crash.
    await ServiceStopper.stop(dataDirectory: plan.dataDirectory)
    guard generation == self.generation else { return }
    do {
      try await spawn(generation: generation)
    } catch {
      guard generation == self.generation else { return }
      RelayLog.service.error("The service did not start: \(error.localizedDescription)")
      fail(.failed(error.localizedDescription))
    }
  }

  /// Manual restart (menu): forgets the crash history, stops the service, starts a new one.
  public func restart() async {
    policy.reset()
    await stopService()
    await start()
  }

  /// Quit: ends supervision and stops the service; never respawns.
  public func stop() async {
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
      _ = await ServiceStopper.waitForExit(spawned.pid, timeout: .seconds(5))
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
    process.onExit = { [weak self] description in
      self?.unexpectedExit(generation, "The service (pid \(process.pid)) \(description)")
    }
    if !process.isRunning {
      return unexpectedExit(generation, "The service (pid \(process.pid)) exited at startup")
    }
    RelayLog.service.info("The service is running (pid \(endpoint.pid)).")
    live(endpoint, generation: generation, adopted: false)
  }

  private func live(_ endpoint: ServiceEndpoint, generation: Int, adopted: Bool) {
    policy.serviceBecameLive()
    state = .running(endpoint)
    ready.resumeAll(with: endpoint)
    guard adopted else { return }
    watcher = Task { @MainActor [weak self] in
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
    switch policy.unexpectedExit() {
    case .giveUp:
      RelayLog.service.error("\(reason). Three unexpected exits in five minutes; giving up.")
      invalidate()
      fail(.stoppedTooOften)
    case .restart(let delay):
      RelayLog.service.error("\(reason). Restarting in \(delay).")
      state = .restarting
      watcher = Task { @MainActor [weak self] in
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
}
