import AIComputerDriverKit
import AICore
import Foundation

/// Requests to the running driver: each bounded, cancellable through its operation, and retried
/// briefly while the driver reports the target process busy with an earlier action (nothing was
/// sent then). A request that sends input and ends without the driver's own answer may have
/// acted; it is reported with ``ComputerFailure/mayHaveDispatched`` and never repeated.
extension NativeEngine {
  /// How long a read (probe, snapshot, capture, prepare) may take.
  static let readLimit: Duration = .seconds(15)
  /// How long the host waits past a `perform`'s own deadline before the driver counts as stuck.
  static let performGrace: Duration = .seconds(2)
  /// The least time before the step's deadline a `perform` is still sent with; the typing guard
  /// stops waiting for the person that early too.
  static let leastSendTime: Duration = .milliseconds(300)
  /// The tries a request gets while its target process is busy, and the pause between them.
  static let busyTries = 3
  static let busyPause: Duration = .milliseconds(250)

  static let notRunning = ComputerFailure(
    .engineFailed, "The computer-use driver is not running; list targets again.")

  /// One request, as the driver answered it.
  func request(_ request: DriverRequest, timeout: Duration, operation: String?) async
    -> Result<DriverResult, DriverClientFailure>
  {
    guard generation != nil else { return .failure(.notRunning) }
    if let operation, stopping.contains(operation) { return .failure(.cancelled(sent: false)) }
    activeCalls += 1
    defer {
      activeCalls -= 1
      if activeCalls == 0, generation != nil { scheduleIdleStop() }
    }
    var tries = 0
    while true {
      tries += 1
      let client = self.client
      let call = Task { await client.send(request, timeout: timeout) }
      if let operation { cancels[operation] = { call.cancel() } }
      let result = await call.value
      if let operation { cancels[operation] = nil }
      guard case .failure(.refused(let refusal)) = result, NativeDriverFailureMap.isBusy(refusal),
        tries < Self.busyTries, !(operation.map(stopping.contains) ?? false)
      else { return result }
      try? await Task.sleep(for: Self.busyPause)
    }
  }

  /// A read's answer of the `expected` type, or why there is none.
  func fetch<T>(
    _ request: DriverRequest, operation: String?, _ expected: (DriverResult) -> T?
  ) async throws(ComputerFailure) -> T {
    let result = await self.request(request, timeout: Self.readLimit, operation: operation)
    switch result {
    case .success(let answer):
      guard let value = expected(answer) else {
        throw ComputerFailure(.engineFailed, "The driver answered a \(request.kind) unexpectedly.")
      }
      return value
    case .failure(let failure):
      throw self.failure(failure, kind: request.kind, writes: false)
    }
  }

  /// A failed request as the coordinator sees it. `writes` says whether it may have sent input.
  func failure(_ failure: DriverClientFailure, kind: String, writes: Bool) -> ComputerFailure {
    switch failure {
    case .notRunning:
      return Self.notRunning
    case .launch(let message):
      return ComputerFailure(.engineFailed, message)
    case .exited:
      return ComputerFailure(
        .engineFailed, "The computer-use driver stopped during the \(kind).",
        mayHaveDispatched: writes)
    case .timedOut:
      return ComputerFailure(
        .timeout, "The computer-use driver did not answer the \(kind) in time.",
        mayHaveDispatched: writes)
    case .cancelled(let sent):
      return ComputerFailure(
        .cancelled, "The \(kind) was cancelled.", mayHaveDispatched: writes && sent)
    case .refused(let refusal):
      let mapped = NativeDriverFailureMap.read(refusal)
      return ComputerFailure(
        mapped.code, "The driver refused the \(kind): \(refusal.message ?? refusal.code.rawValue)",
        reason: mapped.reason)
    case .malformed(let message):
      return ComputerFailure(.engineFailed, message, mayHaveDispatched: writes)
    }
  }

  // MARK: Reads

  func probe(_ place: NativeSurfaceRead, operation: String?) async throws(ComputerFailure)
    -> DriverProbeResult
  {
    try await fetch(.probe(DriverProbeRequest(target: place.driverTarget)), operation: operation) {
      if case .probe(let probe) = $0 { probe } else { nil }
    }
  }

  /// A fresh snapshot of the window `place` reads; it becomes that window's newest, so tokens
  /// of its earlier snapshots stop resolving.
  func snapshot(_ place: NativeSurfaceRead, operation: String?)
    async throws(ComputerFailure) -> DriverSnapshotResult
  {
    let request = DriverSnapshotRequest(
      target: place.driverTarget, maxElements: Self.readElements)
    let snapshot = try await fetch(.snapshot(request), operation: operation) {
      if case .snapshot(let snapshot) = $0 { snapshot } else { nil }
    }
    guard snapshot.target == place.driverTarget else {
      throw ComputerFailure(.targetChanged, "The driver read another window.")
    }
    snapshots[place.windowKey] = snapshot.snapshotId
    return snapshot
  }

  /// The window's pixels through the driver, for a window on another Space where
  /// ScreenCaptureKit returns nothing.
  func offSpaceCapture(_ place: NativeSurfaceRead, operation: String?)
    async throws(ComputerFailure) -> DriverCaptureResult
  {
    guard capabilities.contains(DriverCapabilityName.offSpaceCapture) else {
      throw ComputerFailure(.unsupported, "Windows on another Space cannot be captured here.")
    }
    return try await fetch(
      .capture(DriverCaptureRequest(target: place.driverTarget)), operation: operation
    ) { if case .capture(let capture) = $0 { capture } else { nil } }
  }

  /// Elements one snapshot walks; the observation keeps at most 300 of them.
  static let readElements = 600

  // MARK: Pinning

  /// Chromium, Electron and WebKit stop rendering once covered, and Chromium builds its web tree
  /// only on request. While the window is still unoccluded the driver pins its visible state; a
  /// window that is covered now is tried again on the next observation (plan §4.4), unless the
  /// driver latched keep-alive off. The Chromium family's web accessibility is asked for once per
  /// process, whatever comes of it: the driver waits up to 3 s for a web area then, and the
  /// attribute stays on, so a tree the app builds later is in a later observation's snapshot
  /// (and the probe's web-area check) without another wait, while an app that never shows one,
  /// such as an embedded browser exposing only its window, pays the wait once rather than on
  /// every observation. Only an app that took neither attribute, which nothing waited for, is
  /// asked again. What came of it goes on the observation's line in the log (`web`, `pin`).
  func prepare(
    _ place: NativeSurfaceRead, toolkit: DriverToolkit, for ref: TargetRefWire,
    phases: OperationPhases
  ) async {
    let web = [.chromium, .electron, .cef].contains(toolkit)
    guard web || toolkit == .webKit else { return }
    if pinned[place.windowKey] != nil {
      pinned[place.windowKey]?.insert(ref.id)
      phases.note("pin", DriverKeepAliveOutcome.pinned.rawValue)
      return
    }
    let process = NativeProcessKey.running(place.pid)
    let keepAlive = capabilities.contains(DriverCapabilityName.occlusionKeepAlive)
    let enableWeb = web && process.map { !webAccessibility.contains($0) } == true
    guard keepAlive || enableWeb else { return }
    let request = DriverPrepareRequest(
      target: place.driverTarget, enableWebAccessibility: enableWeb, occlusionKeepAlive: keepAlive)
    let prepared: DriverPrepareResult
    do throws(ComputerFailure) {
      prepared = try await fetch(.prepare(request), operation: nil) {
        if case .prepare(let prepared) = $0 { prepared } else { nil }
      }
    } catch {
      phases.note("prepareFailed", error.code.rawValue)
      return
    }
    if let outcome = prepared.webAccessibility {
      phases.note("web", outcome.rawValue)
      if outcome != .refused, let process { webAccessibility.insert(process) }
    }
    if let outcome = prepared.occlusionKeepAlive {
      phases.note("pin", outcome.rawValue)
      switch outcome {
      case .pinned: pinned[place.windowKey, default: []].insert(ref.id)
      case .covered: break
      case .failed, .unavailable: driverTurnedOff(DriverCapabilityName.occlusionKeepAlive)
      }
    }
  }

  /// Undoes the pins `ref` holds: a window no other ref needs is released (its occlusion
  /// notifications restored; web accessibility stays on). The ref no longer keeps the driver
  /// running; once no ref does, the idle timer runs again.
  func releaseTarget(_ ref: TargetRefWire) async {
    guard ref.engineGeneration == generation else { return }
    if targets[ref.id]?.ref == ref { targets[ref.id]?.released = true }
    defer { if activeCalls == 0, generation != nil, !holdsRefs { scheduleIdleStop() } }
    var released: [DriverTarget] = []
    for (key, holders) in pinned where holders.contains(ref.id) {
      let rest = holders.subtracting([ref.id])
      pinned[key] = rest.isEmpty ? nil : rest
      if rest.isEmpty, let target = Self.driverTarget(windowKey: key) { released.append(target) }
    }
    for target in released {
      _ = await request(
        .release(DriverReleaseRequest(target: target)), timeout: .seconds(3), operation: nil)
    }
  }

  private static func driverTarget(windowKey: String) -> DriverTarget? {
    let parts = windowKey.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return nil }
    return DriverTarget(pid: parts[0], windowId: parts[1])
  }
}
