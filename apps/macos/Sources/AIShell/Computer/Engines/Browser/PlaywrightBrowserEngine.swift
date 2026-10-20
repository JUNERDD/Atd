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
/// `targetChanged` too. An observation belongs to one worker generation and one page: a worker
/// restart makes it stale, since element refs, versions and `newText` baselines restart with it.
final class PlaywrightBrowserEngine: ComputerEngine {
  /// The pinned playwright-core the worker runs: the profile's engine version.
  static let playwrightVersion = "1.63.0"
  /// Short checks of a condition after an action (postconditions).
  static let checkTimeoutMs = 2000
  /// The steps the engine performs, every one in the background.
  static let actions: [ComputerStepKind] = [
    .navigate, .fill, .press, .scroll, .wait, .clear, .key, .select, .upload,
  ]
  /// The steps whose flows were verified at parity with the shipped engine; the rest are
  /// listed unverified until they are qualified end to end.
  static let verifiedActions: Set<ComputerStepKind> = [
    .navigate, .fill, .press, .scroll, .wait,
  ]

  /// One observation as the worker made it: what its element refs, version and baseline mean,
  /// and the page (surface) it read.
  struct ObservationRecord {
    let refId: String
    let pageId: String
    let workerGeneration: Int
    let navigationGeneration: Int?
    let version: Int
    let url: String?
    let baselineId: String?
    let elements: [ObservationElementWire]
  }

  let id = ComputerEngineID.playwright
  private(set) var profile: CapabilityProfileWire
  private(set) var generation: Int?
  let chromes: ManagedChromes
  let workers: BrowserWorkerPool
  /// `<dataDir>/computer/downloads`: each run's downloads go to its own directory below it.
  let downloadsRoot: URL
  /// `<dataDir>/resources`: the task resource store an upload's files must be in.
  let uploadRoot: URL
  private var binaries: EngineBinaries
  private var starts = 0
  /// The binding each live ref was resolved from: its allowed sites bound every write.
  var bindings: [String: TargetBindingWire.Browser] = [:]
  /// The surfaces of each live ref: its bound page and the popups admitted so far.
  var surfaces: [String: BrowserSurfaceSet] = [:]
  private var observations: [String: ObservationRecord] = [:]
  private var observationOrder: [String] = []
  private var observationCount = 0
  /// The page text a `press` captured just before clicking, per ref and page; a later `newText`
  /// compares against it. Cleared by each new observation of that page.
  var pressBaselines: [String: String] = [:]

  init(
    chromes: ManagedChromes, workers: BrowserWorkerPool, binaries: EngineBinaries,
    downloadsRoot: URL, uploadRoot: URL
  ) {
    self.chromes = chromes
    self.workers = workers
    chromes.workers = workers
    self.binaries = binaries
    self.downloadsRoot = downloadsRoot
    self.uploadRoot = uploadRoot
    profile = Self.makeProfile(
      chromeVersion: chromes.version, workerReady: Self.isStaged(binaries))
  }

  // MARK: Lifecycle

  /// Installed while the `computer-browser` add-on is (``EngineBinaries/browserWorker``).
  var isInstalled: Bool { binaries.browserWorker != nil }

  func install(_ binaries: EngineBinaries) -> Bool {
    let changed = binaries.browserWorker != self.binaries.browserWorker
    self.binaries = binaries
    workers.binaries = binaries
    profile = Self.makeProfile(chromeVersion: chromes.version, workerReady: Self.isStaged(binaries))
    return changed
  }

  func start() async throws {
    guard generation == nil else { return }
    let ready = Self.isStaged(binaries)
    profile = Self.makeProfile(chromeVersion: chromes.version, workerReady: ready)
    guard ready else {
      let worker = binaries.browserWorker?.path(percentEncoded: false) ?? "not installed"
      throw ComputerFailure(
        .engineFailed,
        "The browser worker cannot run (Node \(binaries.node.path(percentEncoded: false)), "
          + "worker \(worker)).")
    }
    starts += 1
    generation = starts
  }

  /// Stops the workers. The managed browsers keep running: the person signed in there, and the
  /// next run reuses them.
  func shutdown() async {
    generation = nil
    bindings = [:]
    surfaces = [:]
    observations = [:]
    observationOrder = []
    pressBaselines = [:]
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

  /// The managed browser of the ref. It being the frontmost app is necessary for the person to be
  /// using the target, not sufficient: ``isInUse(_:)`` looks at the pages.
  func foregroundProcess(of ref: TargetRefWire) -> pid_t? {
    guard let page = ref.browser, let instance = chromes.tracked(page.profileId),
      instance.contextId == page.contextId
    else { return nil }
    return instance.pid
  }

  /// Observes the bound page or one of its popups and lists the target's surfaces. A page has no
  /// capture geometry: a region is refused, and recognized text is reported unavailable rather
  /// than approximated.
  func observe(
    _ ref: TargetRefWire, _ operation: ObserveOperationWire, context: EngineObserveContext
  )
    async throws(ComputerFailure) -> ObservationWire
  {
    var published = false
    defer { if !published { invalidateObservation(ref) } }
    try context.check()
    guard operation.region == nil else {
      throw ComputerFailure(.unsupported, "Browser targets have no capture regions.")
    }
    let screenshot = operation.include.screenshot
    let (_, instance, binding) = try await target(ref)
    try context.check()
    let set = try await refreshSurfaces(ref, instance, binding)
    try context.check()
    guard let pageId = set.pageId(of: operation.surfaceRefId) else { throw Self.surfaceGone }
    let (raw, workerGeneration) = try await call(
      instance, "observe",
      [
        "pageId": .string(pageId), "screenshot": .bool(screenshot),
        "operationId": .string(context.operationId),
        "allowedOrigins": Self.origins(binding),
      ], timeout: .seconds(20), writes: false)
    try context.check()
    let reply = try checked(raw, "observe")
    guard let version = reply.observationVersion else {
      throw ComputerFailure(.engineFailed, "The browser worker observed no version.")
    }
    observationCount += 1
    let observationRef = ObservationRefWire(
      id: "o\(workerGeneration).\(observationCount)", targetRefId: ref.id, version: version,
      capturedAt: Date())
    let elements = reply.elementsWire
    remember(
      ObservationRecord(
        refId: ref.id, pageId: pageId, workerGeneration: workerGeneration,
        navigationGeneration: reply.navigationGeneration, version: version,
        url: reply.url, baselineId: reply.baselineId, elements: elements),
      id: observationRef.id)
    pressBaselines[Self.baselineKey(ref.id, pageId)] = nil
    let onSite = reply.url.map { BrowserOrigins.allows($0, origins: binding.allowedOrigins) }
    let root = pageId == set.boundPageId
    published = true
    return ObservationWire(
      ref: observationRef, url: reply.url, title: reply.title, elements: elements,
      screenshot: screenshot ? reply.screenshotWire : nil,
      capabilities: onSite == true ? profile.effects : [.read, .navigate],
      surfaceRefId: root ? nil : operation.surfaceRefId,
      surfaces: set.wire(pid: Int(instance.pid), processStart: String(instance.start)),
      problems: operation.include.text ? [.textUnavailable] : nil)
  }

  func invalidateObservation(_ ref: TargetRefWire) {
    observations = observations.filter { $0.value.refId != ref.id }
    observationOrder.removeAll { observations[$0] == nil }
    pressBaselines = pressBaselines.filter { !$0.key.hasPrefix(ref.id + " ") }
  }

  /// Checks a condition on the page `baseline` read (the bound page without one).
  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?
  ) async throws(ComputerFailure) -> Bool {
    let (page, instance, binding) = try await target(ref)
    let record = baseline.flatMap { observations[$0.ref.id] } ?? latestObservation(of: ref.id)
    let pageId = record?.pageId ?? page.pageId
    let workerCondition = try self.condition(
      condition, refId: ref.id, pageId: pageId, record: record, unattended: false)
    let (reply, _) = try await call(
      instance, "wait",
      [
        "pageId": .string(pageId), "condition": workerCondition,
        "timeoutMs": .int(Self.checkTimeoutMs), "allowedOrigins": Self.origins(binding),
      ], timeout: .seconds(8), writes: false,
      pinned: Self.usesRecord(condition) ? record?.workerGeneration : nil)
    if !reply.ok, reply.error?.code == "timeout" { return false }
    return try checked(reply, "wait").satisfied == true
  }

  // MARK: Shared

  /// The ref's bound page, its running browser and its binding; `targetChanged` when any of
  /// them is no longer the one the ref was resolved for.
  func target(_ ref: TargetRefWire) async throws(ComputerFailure) -> (
    TargetRefWire.Browser, ManagedChromeInstance, TargetBindingWire.Browser
  ) {
    guard let page = ref.browser, ref.engine == .playwright, ref.engineGeneration == generation,
      let binding = bindings[ref.id]
    else {
      throw ComputerFailure(
        .targetChanged, "The browser target is not current; list targets again.")
    }
    guard let instance = await chromes.running(page.profileId),
      instance.contextId == page.contextId
    else {
      throw ComputerFailure(
        .targetChanged, "The managed browser quit or restarted; list targets again.")
    }
    return (page, instance, binding)
  }

  /// An observation the next step may use: made by this ref's page and the running worker.
  func currentObservation(_ id: String, ref: TargetRefWire.Browser, refId: String)
    throws(ComputerFailure) -> ObservationRecord
  {
    guard let record = observations[id], record.refId == refId,
      record.workerGeneration
        == workers.generation(profileId: ref.profileId, contextId: ref.contextId)
    else {
      throw ComputerFailure(
        .staleObservation, "The observation is no longer current; observe the target again.")
    }
    return record
  }

  /// Where a `press` baseline of `pageId` under `refId` is kept.
  static func baselineKey(_ refId: String, _ pageId: String) -> String { refId + " " + pageId }

  /// Whether a condition names elements or a baseline of an observation.
  private static func usesRecord(_ condition: ComputerConditionWire) -> Bool {
    switch condition {
    case .enabled, .valueEquals, .newText: true
    case .textAppears, .urlMatches, .menuItemAvailable: false
    }
  }

  private func latestObservation(of refId: String) -> ObservationRecord? {
    observationOrder.last { observations[$0]?.refId == refId }.flatMap { observations[$0] }
  }

  private func remember(_ record: ObservationRecord, id: String) {
    observations[id] = record
    observationOrder.append(id)
    while observationOrder.count > 32 { observations[observationOrder.removeFirst()] = nil }
  }

  /// Whether the pinned Node and the add-on's worker are where this build runs them from.
  private static func isStaged(_ binaries: EngineBinaries) -> Bool {
    guard let worker = binaries.browserWorker else { return false }
    return EngineBinaries.isExecutable(binaries.node) && EngineBinaries.isReadable(worker)
  }
}
