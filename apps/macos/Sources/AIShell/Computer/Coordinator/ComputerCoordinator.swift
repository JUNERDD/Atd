import AICore
import AIRelay
import Foundation
import OSLog

/// The one owner of computer execution on this Mac (D6, plan §4, §6): it answers the service's
/// `computer.request`s as the bound host, in the fixed order of plan §6.1 for every action —
/// verify host id, generation and service epoch; check live permissions and the lock screen;
/// claim the target's resources through the ``DeviceArbiter`` within the request's deadline;
/// re-validate the target, cancellation and observation; journal the intent durably; dispatch
/// the steps one by one, yielding to the person between them and watching each write for
/// disturbances (``disturbance``); journal the result; release the claim only once the effect
/// converged.
///
/// Engines plug in through ``engines``; targets the model may name live in ``targets``. Every
/// route is background: nothing here activates an app, claims the shared input or asks the
/// person mid-run. The coordinator never prompts for a permission in an unattended request,
/// never dispatches an action it could not journal, and never runs an action id twice.
final class ComputerCoordinator: ComputerRequestHandling {
  static let hostIdKey = "computer.hostId"
  static let pointerVisibleKey = "computer.pointerVisible"
  /// How often a shell that found the host lock busy tries again (D12).
  static let lockRetryInterval: Duration = .seconds(30)
  /// How long quitting waits for running actions to converge.
  static let shutdownLimit: Duration = .seconds(10)
  static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  let host: ComputerHostSession
  let arbiter: DeviceArbiter
  let engines = ComputerEngineRegistry()
  let targets = TargetRegistry()
  let previews = ComputerPreviewCoordinator()
  let sharing = ScreenSharingSession()
  var previewConnected = false {
    didSet { if !previewConnected { sharing.end(.disconnected) } }
  }
  var previewServiceEpoch: String?
  let progress: ComputerProgressReporter
  let typing: ComputerTypingPreferences
  let pointer: ActivityPointerController
  let disturbance = DisturbanceGuard()
  /// Whether the person prepared screen-capture consent, which unattended captures need.
  let captureConsent: CaptureConsentPrimer
  let defaults: UserDefaults
  /// Prepares targets from Settings; set by the engine adapters.
  var preparer: (any ComputerTargetPreparer)?
  var accessPreparer: ComputerAccessPreparer?
  /// This shell's host id: stable per installation, so a restart is a new generation of the
  /// same host and another app build is another host.
  let hostId: String
  /// Sends `computer.hello` again on the open connection.
  var announce: (() -> Void)?
  /// The host, its engines or the pointer setting changed (`computer.state`).
  var onStateChange: (() -> Void)?

  /// Actions in flight, by action id.
  var executions: [String: ActionExecution] = [:]
  var cancelled = CancelledRuns()
  private(set) var stopping = false
  private(set) var started = false
  private var epochs = ServiceEpochTracker()
  /// Actions whose reply could not be delivered, re-reported in `computer.hello` until the
  /// service asked for their status.
  private var undelivered: [String] = []
  /// Marker-only actions the service has seen, acknowledged at the next idle refresh.
  private var acknowledged: Set<String> = []
  /// Set when the journal settled actions since the last refresh of the unsettled set.
  var needsRefresh = false
  private var lockRetry: Task<Void, Never>?
  /// Publishes the state again when Atd becomes active (``observeGrants()``).
  var grantObserver: (any NSObjectProtocol)?

  init(
    host: ComputerHostSession, arbiter: DeviceArbiter, pointer: ActivityPointerController,
    defaults: UserDefaults
  ) {
    self.host = host
    self.arbiter = arbiter
    self.pointer = pointer
    self.defaults = defaults
    typing = ComputerTypingPreferences(defaults: defaults)
    progress = ComputerProgressReporter(pointer: pointer)
    captureConsent = CaptureConsentPrimer(
      directory: host.lock.directory,
      bundleId: Bundle.main.bundleIdentifier ?? ProcessInfo.processInfo.processName)
    if let stored = defaults.string(forKey: Self.hostIdKey) {
      hostId = stored
    } else {
      hostId = UUID().uuidString.lowercased()
      defaults.set(hostId, forKey: Self.hostIdKey)
    }
    pointer.isEnabled = defaults.object(forKey: Self.pointerVisibleKey) as? Bool ?? true
    engines.onChange = { [weak self] in
      self?.announce?()
      self?.onStateChange?()
    }
    previews.onChange = { [weak self] in self?.onStateChange?() }
    sharing.onSourceAdded = { [weak self] share in
      guard let self, let stream = share.stream else { return }
      let sourceId = share.id
      self.previews.registerShared(
        taskId: share.taskId, runId: share.runId, sourceId: sourceId, label: share.label,
        frames: stream.output,
        isCurrent: { [weak self, weak share] in
          guard let self, let share else { return false }
          return self.sharing.contains(share) && share.id == sourceId
        })
    }
    sharing.onSourceRemoved = { [weak self] id in self?.previews.removeShared(sourceId: id) }
    sharing.beforeSourceStart = { [weak self] in await self?.previews.settleRetirements() }
    disturbance.engineProcesses = { [weak self] in
      guard let self else { return [] }
      return ComputerEngineID.allCases.reduce(into: Set<pid_t>()) {
        $0.formUnion(self.engines.engine($1)?.inputProcesses ?? [])
      }
    }
  }

  // MARK: Lifecycle

  /// Takes the host lock (retrying while another Atd holds it) and reports the state.
  func start() {
    guard !started else { return }
    started = true
    if !host.start() { retryLock() }
    observeGrants()
    onStateChange?()
  }

  /// The quit path: admit nothing, stop running actions and let them converge, then stop the
  /// engines and give up the host lock.
  func shutdown() async {
    guard !stopping else { return }
    stopping = true
    await sharing.shutdown()
    await previews.stopAll()
    lockRetry?.cancel()
    arbiter.setBackgroundAdmission(.closed(.stopping))
    let quitting = ComputerFailure(.cancelled, "Atd is quitting.")
    for execution in executions.values { execution.requestStop(quitting) }
    let limit = ContinuousClock.now + Self.shutdownLimit
    while !executions.isEmpty, ContinuousClock.now < limit {
      try? await Task.sleep(for: .milliseconds(50))
    }
    progress.clearAll()
    await accessPreparer?.finishAll()
    await release(targets.releaseAll())
    await engines.shutdownAll()
    targets.removeAll()
    host.stop()
    onStateChange?()
  }

  /// The actions keeping background writes closed that a person may review (D17): what the host
  /// holds as unsettled, less any action still running here.
  var reviewable: [String] {
    host.unsettledActionIds.filter { executions[$0] == nil }
  }

  private func retryLock() {
    lockRetry = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.lockRetryInterval)
        guard let self, !self.stopping, !Task.isCancelled else { return }
        if self.host.start() {
          self.announce?()
          self.onStateChange?()
          return
        }
      }
    }
  }

  // MARK: ComputerRequestHandling

  func computerHello() -> ComputerHelloWire {
    let generation = host.generation ?? HostGeneration.stored(in: host.lock.directory) ?? 1
    var unsettled: [String] = []
    for id in host.unsettledActionIds + (host.journal?.unsettled.map(\.actionId) ?? [])
      + undelivered
    where !unsettled.contains(id) {
      unsettled.append(id)
    }
    return ComputerHelloWire(
      hostId: hostId, hostGeneration: generation,
      lockHeld: host.lock.isHeld && host.generation != nil, profiles: engines.profiles,
      unsettled: unsettled)
  }

  func cancel(_ cancel: ComputerCancelWire) {
    sharing.cancel(cancel)
    cancelled.cancel(runId: cancel.runId, operationId: cancel.operationId, reason: cancel.reason)
    if cancel.operationId == nil {
      // The run's computer work is over (`finished` when it simply ended): its previews and
      // run-scoped browser profiles go, and the targets no other run uses lose their
      // preparation.
      previews.remove(runId: cancel.runId)
      let released = targets.endRun(cancel.runId)
      Task {
        await accessPreparer?.finish(runId: cancel.runId)
        await release(released)
      }
    }
    let failure = ComputerFailure(
      cancel.reason == .timedOut ? .timeout : .cancelled,
      "The run's computer work was stopped (\(cancel.reason.rawValue)).")
    for execution in executions.values
    where CancelledRuns.covers(
      runId: cancel.runId, operationId: cancel.operationId,
      target: (execution.runId, execution.operationId))
    {
      execution.requestStop(failure)
    }
  }

  func replyFinished(_ request: HostRequestWire, delivered: Bool) {
    switch request.op {
    case .act(let action) where !delivered:
      if !undelivered.contains(action.actionId) { undelivered.append(action.actionId) }
      // The service marked it unknown when the connection closed; a hello on the connection
      // open now makes it ask for the recorded result.
      announce?()
    case .status(let actionIds) where delivered:
      reconciled(actionIds)
    default:
      break
    }
  }

  // MARK: Reconciliation

  /// The service now holds these actions' records: actions an earlier host left `unknown` settle
  /// with an unknown effect, marker-only ones are acknowledged, and background writes reopen once
  /// nothing is open.
  private func reconciled(_ actionIds: [String]) {
    for id in actionIds { undelivered.removeAll { $0 == id } }
    settle(actionIds) { $0 == .unknown }
  }

  /// `computer.acknowledgeUnsettled` (D17): a person checked the apps and sites these actions may
  /// have changed, which no service record could settle (another data directory, a lost record).
  /// Each still held unsettled and not running here settles with an unknown effect, the service
  /// learns of it through the next hello, and background writes reopen once nothing is open.
  func acknowledgeUnsettled(_ actionIds: [String]) {
    let open = Set(reviewable)
    let reviewed = actionIds.filter { open.contains($0) }
    guard !reviewed.isEmpty else { return }
    settle(reviewed) { $0.isUnsettled }
    announce?()
  }

  /// Settles the journaled ones among `actionIds` whose phase `settles` allows with an unknown
  /// effect, and acknowledges those only the marker names; refreshes admission once idle.
  private func settle(_ actionIds: [String], when settles: (OperationPhase) -> Bool) {
    guard let journal = host.journal, let generation = host.generation else { return }
    for id in actionIds {
      if let entry = journal.entry(for: id) {
        guard settles(entry.phase), let result = try? JSONValue(encoding: Self.lost(id))
        else { continue }
        try? journal.append(
          HostJournalEntry(
            actionId: id, runId: entry.runId, operationId: entry.operationId,
            hostGeneration: generation, phase: .settled, result: result, at: .now))
      } else if host.unsettledActionIds.contains(id) {
        acknowledged.insert(id)
      }
    }
    needsRefresh = true
    refreshIfIdle()
  }

  /// Recomputes the unsettled set once no action is in flight; an in-flight action's intent is
  /// not a lost one, and must not close admission for the others.
  func refreshIfIdle() {
    guard executions.isEmpty, needsRefresh else { return }
    needsRefresh = false
    host.refreshUnsettled(acknowledging: acknowledged)
    acknowledged = []
    onStateChange?()
  }

  /// The result of an action a host lost before it settled.
  static func lost(_ actionId: String) -> ActionResultWire {
    ActionResultWire(
      actionId: actionId, dispatch: .dispatched, effect: .unknown, completedSteps: 0,
      stoppedAt: nil,
      error: ComputerErrorWire(
        code: .hostUnavailable,
        message: "The host stopped before this action settled; whether it took effect is unknown."),
      evidence: [], retry: .never, invalidated: nil)
  }

  /// A new service epoch: work of the old one cannot reach its run any more.
  func noteEpoch(_ epoch: String) {
    previewServiceEpoch = epoch
    guard case .changed(let previous) = epochs.observe(epoch) else { return }
    sharing.end(.disconnected)
    previews.removeAll()
    // No run of the old epoch reaches this host any more.
    let released = targets.releaseAll()
    Task {
      await accessPreparer?.finishAll()
      await release(released)
    }
    let restarted = ComputerFailure(.cancelled, "The agent service restarted.")
    for execution in executions.values where execution.serviceEpoch == previous {
      execution.requestStop(restarted)
    }
  }

  /// Undoes the engines' preparation of targets no run uses any more (plan §4.4: occlusion
  /// keep-alive ends with the run, the release, a deleted binding or the host's quit).
  func release(_ refs: [TargetRefWire]) async {
    for ref in refs { await engines.engine(ref.engine)?.releaseTarget(ref) }
  }
}
