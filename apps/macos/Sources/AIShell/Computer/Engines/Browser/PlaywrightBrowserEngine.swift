import AICore
import Darwin
import Foundation
import MCP

/// The `playwright` engine (D13, D15; contract v1.3): browser targets in managed Chrome profiles,
/// driven through the browser worker (playwright-core over CDP, ``BrowserWorkerPool``). It acts
/// only on pages of a managed browser that already runs (``ManagedChromes``); it never starts,
/// activates or raises Chrome, selects a tab or sends native input, so it claims only the bound
/// page (`affectsSystemInput` false). A run's website opens in a background tab, not here.
///
/// A target ref names the bound page by profile, browser process (`contextId`) and CDP page id; a
/// browser that quit or restarted makes it `targetChanged`. Popups the bound page opened on the
/// binding's sites are its other surfaces (``BrowserSurfaceSet``); one that closed is
/// `targetChanged` too. Observing, acting and checking go through the shared ``BrowserPageDriver``;
/// this engine owns the managed browsers, resolution, occupancy and its profile.
final class PlaywrightBrowserEngine: ComputerEngine, BrowserPageOwner {
  /// The steps whose flows were verified at parity with the shipped engine; the rest are
  /// listed unverified until they are qualified end to end.
  static let verifiedActions: Set<ComputerStepKind> = [
    .navigate, .fill, .press, .scroll, .wait,
  ]

  let id = ComputerEngineID.playwright
  private(set) var profile: CapabilityProfileWire
  private(set) var generation: Int?
  let chromes: ManagedChromes
  let workers: BrowserWorkerPool
  /// The refs, their surfaces and observations, and every worker call on their pages.
  let driver: BrowserPageDriver
  private var binaries: EngineBinaries
  private var starts = 0

  init(
    chromes: ManagedChromes, workers: BrowserWorkerPool, binaries: EngineBinaries,
    downloadsRoot: URL, uploadRoot: URL
  ) {
    self.chromes = chromes
    self.workers = workers
    chromes.workers = workers
    self.binaries = binaries
    driver = BrowserPageDriver(
      workers: workers, uploadRoot: uploadRoot, downloadsRoot: downloadsRoot)
    profile = Self.makeProfile(
      chromeVersion: chromes.version, workerReady: BrowserWorkerPool.isStaged(binaries))
    driver.owner = self
  }

  // MARK: Lifecycle

  /// Installed while the `computer-browser` add-on is (``EngineBinaries/browserWorker``).
  var isInstalled: Bool { binaries.browserWorker != nil }

  func install(_ binaries: EngineBinaries) -> Bool {
    let changed = binaries.browserWorker != self.binaries.browserWorker
    self.binaries = binaries
    workers.binaries = binaries
    profile = Self.makeProfile(
      chromeVersion: chromes.version, workerReady: BrowserWorkerPool.isStaged(binaries))
    return changed
  }

  func start() async throws {
    guard generation == nil else { return }
    let ready = BrowserWorkerPool.isStaged(binaries)
    profile = Self.makeProfile(chromeVersion: chromes.version, workerReady: ready)
    guard ready else { throw BrowserWorkerPool.notStaged(binaries) }
    starts += 1
    generation = starts
  }

  /// Stops the workers. The managed browsers keep running: the person signed in there, and the
  /// next run reuses them.
  func shutdown() async {
    generation = nil
    driver.reset()
    await workers.shutdownAll()
  }

  func cancel(operationId: String) async {
    await workers.cancel(operationId: operationId)
  }

  /// The bound page: every action on the target, also on one of its popups, queues behind it.
  func resources(for ref: TargetRefWire) -> Set<DeviceResource> {
    guard let page = ref.browser else { return [] }
    return [.page(profileId: page.profileId, contextId: page.contextId, pageId: page.pageId)]
  }

  /// The managed browser of the ref. It being the frontmost app is necessary for the target to be
  /// in front of the person, not sufficient: ``isInFront(_:)`` looks at the pages.
  func foregroundProcess(of ref: TargetRefWire) -> pid_t? {
    guard let page = ref.browser, let instance = chromes.tracked(page.profileId),
      instance.contextId == page.contextId
    else { return nil }
    return instance.pid
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
    try await driver.perform(step, on: ref, observation: observation, context: context)
  }

  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?,
    context _: EngineCheckContext
  ) async throws(ComputerFailure) -> Bool {
    try await driver.check(condition, on: ref, baseline: baseline)
  }

  /// The profile's running browser, while it is the process the ref was resolved in.
  func endpoint(of page: TargetRefWire.Browser, refId _: String) async throws(ComputerFailure)
    -> any BrowserWorkerEndpoint
  {
    guard let instance = await chromes.running(page.profileId),
      instance.contextId == page.contextId
    else {
      throw ComputerFailure(
        .targetChanged, "The managed browser quit or restarted; list targets again.")
    }
    return instance
  }
}

extension PlaywrightBrowserEngine: ComputerPreviewProviding {
  func previewSource(_ ref: TargetRefWire, observation: ObservationWire) async throws
    -> ComputerPreviewSource
  {
    try await driver.previewSource(ref, observation: observation)
  }
}
