import AICore
import Foundation
import MCP

/// The engine a ``BrowserPageDriver`` works for: refs must carry its id and running generation,
/// and it alone knows which browser a page of its refs is in (a managed Chrome, or the person's own
/// through its relay).
protocol BrowserPageOwner: ComputerEngine {
  /// The worker endpoint of the browser `page` is in, while it is still the browser the ref
  /// `refId` was resolved in; `targetChanged` or `targetUnavailable` otherwise.
  func endpoint(of page: TargetRefWire.Browser, refId: String) async throws(ComputerFailure)
    -> any BrowserWorkerEndpoint
}

/// The worker-backed half of a browser engine, shared by the managed (`playwright`) and the
/// person's own Chrome (`chrome`) engines: what each live ref was resolved from (its binding, its
/// surfaces), the observations the worker made and their baselines, and every read and write of a
/// ref's pages through the owner's ``BrowserWorkerPool``. The owning engine resolves bindings,
/// decides occupancy and publishes its profile; the driver never starts a browser or opens a page.
///
/// An observation belongs to one worker generation and one page: a worker restart makes it stale,
/// since element refs, versions and `newText` baselines restart with it.
final class BrowserPageDriver {
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

  /// A ref's bound page, the browser it is in and the binding it was resolved from.
  struct Target {
    let page: TargetRefWire.Browser
    let endpoint: any BrowserWorkerEndpoint
    let binding: TargetBindingWire.Browser
  }

  /// Short checks of a condition after an action (postconditions).
  static let checkTimeoutMs = 2000

  let workers: BrowserWorkerPool
  /// `<dataDir>/resources`: the task resource store an upload's files must be in.
  let uploadRoot: URL
  /// `<dataDir>/computer/downloads`: each run's downloads go to its own directory below it. Nil
  /// where the worker saves none (the person's own Chrome keeps its downloads).
  let downloadsRoot: URL?
  weak var owner: (any BrowserPageOwner)?
  /// The binding each live ref was resolved from: its allowed sites bound every write.
  private(set) var bindings: [String: TargetBindingWire.Browser] = [:]
  /// The surfaces of each live ref: its bound page and the popups admitted so far.
  var surfaces: [String: BrowserSurfaceSet] = [:]
  private var observations: [String: ObservationRecord] = [:]
  private var observationOrder: [String] = []
  private var observationCount = 0
  /// The page text a `press` captured just before clicking, per ref and page; a later `newText`
  /// compares against it. Cleared by each new observation of that page.
  var pressBaselines: [String: String] = [:]

  init(workers: BrowserWorkerPool, uploadRoot: URL, downloadsRoot: URL?) {
    self.workers = workers
    self.uploadRoot = uploadRoot
    self.downloadsRoot = downloadsRoot
  }

  // MARK: Refs

  /// Records a ref resolution produced: its binding and bound page, with the popups `pages`
  /// already lists (none yet without a listing). Earlier refs of the same binding go, those
  /// `replaces` accepts (all of them by default).
  func track(
    _ ref: TargetRefWire, binding: TargetBindingWire.Browser, boundPageId: String,
    pages: [BrowserWorkerReply.Page] = [], replaces: (String) -> Bool = { _ in true }
  ) {
    bindings = bindings.filter { $0.value.bindingId != binding.bindingId || !replaces($0.key) }
    surfaces = surfaces.filter { bindings[$0.key] != nil }
    bindings[ref.id] = binding
    var set = BrowserSurfaceSet(targetRefId: ref.id, boundPageId: boundPageId)
    set.reconcile(pages, origins: binding.allowedOrigins)
    surfaces[ref.id] = set
  }

  /// Drops everything kept for `refIds`: they name nothing any more.
  func forget(_ refIds: some Sequence<String>) {
    for refId in refIds {
      bindings[refId] = nil
      surfaces[refId] = nil
      invalidateObservation(refId: refId)
    }
  }

  /// Drops every ref, as the owner's shutdown does.
  func reset() {
    bindings = [:]
    surfaces = [:]
    observations = [:]
    observationOrder = []
    pressBaselines = [:]
  }

  /// The ref's bound page, its browser and its binding; `targetChanged` when any of them is no
  /// longer the one the ref was resolved for.
  func target(_ ref: TargetRefWire) async throws(ComputerFailure) -> Target {
    guard let owner, let page = ref.browser, ref.engine == owner.id,
      ref.engineGeneration == owner.generation, let binding = bindings[ref.id]
    else {
      throw ComputerFailure(
        .targetChanged, "The browser target is not current; list targets again.")
    }
    let endpoint = try await owner.endpoint(of: page, refId: ref.id)
    return Target(page: page, endpoint: endpoint, binding: binding)
  }

  // MARK: Reads

  /// Observes the bound page or one of its popups and lists the target's surfaces. A page has no
  /// capture geometry: a region is refused, and recognized text is reported unavailable rather
  /// than approximated. `effects` are what a page on the binding's sites allows.
  func observe(
    _ ref: TargetRefWire, _ operation: ObserveOperationWire, effects: [ComputerEffect],
    context: EngineObserveContext
  ) async throws(ComputerFailure) -> ObservationWire {
    var published = false
    defer { if !published { invalidateObservation(refId: ref.id) } }
    try context.check()
    guard operation.region == nil else {
      throw ComputerFailure(.unsupported, "Browser targets have no capture regions.")
    }
    let screenshot = operation.include.screenshot
    let target = try await target(ref)
    try context.check()
    let set = try await refreshSurfaces(ref, target)
    try context.check()
    guard let pageId = set.pageId(of: operation.surfaceRefId) else { throw Self.surfaceGone }
    let (raw, workerGeneration) = try await call(
      target.endpoint, "observe",
      [
        "pageId": .string(pageId), "screenshot": .bool(screenshot),
        "operationId": .string(context.operationId),
        "allowedOrigins": Self.origins(target.binding),
      ], timeout: .seconds(20), writes: false)
    try context.check()
    let reply = try raw.checked("observe")
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
    let onSite = reply.url.map {
      BrowserOrigins.allows($0, origins: target.binding.allowedOrigins)
    }
    let root = pageId == set.boundPageId
    published = true
    return ObservationWire(
      ref: observationRef, url: reply.url, title: reply.title, elements: elements,
      screenshot: screenshot ? reply.screenshotWire : nil,
      capabilities: onSite == true ? effects : [.read, .navigate],
      surfaceRefId: root ? nil : operation.surfaceRefId,
      surfaces: set.wire(pid: Int(target.endpoint.pid), processStart: target.endpoint.processStart),
      problems: operation.include.text ? [.textUnavailable] : nil)
  }

  func invalidateObservation(refId: String) {
    observations = observations.filter { $0.value.refId != refId }
    observationOrder.removeAll { observations[$0] == nil }
    pressBaselines = pressBaselines.filter { !$0.key.hasPrefix(refId + " ") }
  }

  /// Checks a condition on the page `baseline` read (the bound page without one), within the
  /// worker's own wait of ``checkTimeoutMs``.
  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?
  ) async throws(ComputerFailure) -> Bool {
    let target = try await target(ref)
    let record = baseline.flatMap { observations[$0.ref.id] } ?? latestObservation(of: ref.id)
    let pageId = record?.pageId ?? target.page.pageId
    let workerCondition = try self.condition(
      condition, refId: ref.id, pageId: pageId, record: record, unattended: false)
    let (reply, _) = try await call(
      target.endpoint, "wait",
      [
        "pageId": .string(pageId), "condition": workerCondition,
        "timeoutMs": .int(Self.checkTimeoutMs), "allowedOrigins": Self.origins(target.binding),
      ], timeout: .seconds(8), writes: false,
      pinned: Self.usesRecord(condition) ? record?.workerGeneration : nil)
    if !reply.ok, reply.error?.code == "timeout" { return false }
    return try reply.checked("wait").satisfied == true
  }

  // MARK: Observations

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
}
