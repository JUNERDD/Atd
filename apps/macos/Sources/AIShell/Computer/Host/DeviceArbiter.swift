import AICore
import Foundation

/// The one owner of this Mac's device resources inside the shell (D6, plan §6.2): every native
/// writer, the computer host's engines and the shell's own features alike, claims the
/// ``DeviceResource``s its effect touches here before it starts. ``ResourceClaimPlan`` decides
/// each claim from what is held and what waits; the arbiter applies the decision, queues waiters
/// in arrival order and re-decides them whenever a claim is released, a waiter leaves or
/// background admission changes.
///
/// Tracks `grantedAt: ContinuousClock.Instant` on every active claim (zero background timers) so
/// `diagnostics.shellReport` and bundle exports lazily identify wedged claims (`> 30_000 ms`), and
/// records `< 200 ns` zero-allocation `CaptureAndArbiterEntry` lifecycle transitions (`01` §4.4).
final class DeviceArbiter {
  private struct Waiter {
    let id: UInt64
    let entry: ClaimEntry
    let continuation: CheckedContinuation<Result<ResourceClaim, ClaimRefusal>, Never>
    let expiry: Task<Void, Never>?
  }

  static let userWait: Duration = .seconds(1)
  static let wedgedThresholdMs: UInt32 = 30_000

  let decisionRing: CaptureAndArbiterRing?
  var onLiveProbeChange: (() -> Void)?

  private var held: [(id: UInt64, entry: ClaimEntry, grantedAt: ContinuousClock.Instant)] = []
  private var waiters: [Waiter] = []
  private var lastID: UInt64 = 0
  private(set) var backgroundAdmission: BackgroundAdmission = .closed(.hostNotHeld)
  var onChange: (() -> Void)?

  init(decisionRing: CaptureAndArbiterRing? = nil) {
    self.decisionRing = decisionRing
  }

  /// The claims granted now, oldest first.
  var heldClaims: [ClaimEntry] { held.map(\.entry) }

  /// Pre-formatted summaries of active claims (including `heldMs` and `[wedged]` marker when held
  /// `> 30s`) for slow `diagnostics.shellReport`, `exportBundle`, and live-probe reads.
  func heldResourceSummaries(now: ContinuousClock.Instant = .now) -> [String] {
    held.prefix(16).map { item in
      let ms = Self.elapsedMs(from: item.grantedAt, to: now)
      let owner = Self.compactOwnerTag(item.entry.owner)
      let res = DeviceResource.acquisitionOrder(item.entry.resources).map(Self.resourceTag).joined(
        separator: "+")
      let flag = ms > Self.wedgedThresholdMs ? ":wedged" : ""
      return "\(owner)[\(res)](\(ms)ms\(flag))"
    }
  }

  func isHeld(_ resource: DeviceResource) -> Bool {
    held.contains { $0.entry.resources.contains(resource) }
  }

  func tryClaim(_ resources: Set<DeviceResource>, owner: ClaimOwner) throws(ClaimRefusal)
    -> ResourceClaim
  {
    let entry = ClaimEntry(owner: owner, resources: resources)
    switch decide(entry, ahead: waiters.map(\.entry)) {
    case .grant:
      defer {
        onChange?()
        onLiveProbeChange?()
      }
      return grant(entry, id: nextID())
    case .wait(let resource):
      recordRefusal(entry: entry, code: 1)
      throw .busy(resource)
    case .refuse(let refusal):
      recordRefusal(entry: entry, code: Self.refusalCode(refusal))
      throw refusal
    }
  }

  func claim(
    _ resources: Set<DeviceResource>, owner: ClaimOwner, deadline: ContinuousClock.Instant?
  ) async throws(ClaimRefusal) -> ResourceClaim {
    try await claim(ClaimEntry(owner: owner, resources: resources), deadline: deadline)
  }

  func escalate(owner: ClaimOwner, deadline: ContinuousClock.Instant) async throws(ClaimRefusal)
    -> ResourceClaim
  {
    try await claim(
      ClaimEntry(owner: owner, resources: [.globalInput], escalation: true), deadline: deadline)
  }

  private func claim(_ entry: ClaimEntry, deadline: ContinuousClock.Instant?)
    async throws(ClaimRefusal) -> ResourceClaim
  {
    guard !Task.isCancelled else { throw .cancelled }
    switch decide(entry, ahead: waiters.map(\.entry)) {
    case .grant:
      defer {
        onChange?()
        onLiveProbeChange?()
      }
      return grant(entry, id: nextID())
    case .refuse(let refusal):
      recordRefusal(entry: entry, code: Self.refusalCode(refusal))
      throw refusal
    case .wait: break
    }
    if let deadline, deadline <= .now {
      recordRefusal(entry: entry, code: 6)
      throw .timeout
    }
    let id = nextID()
    let result = await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        let expiry = deadline.map { deadline in
          Task { [weak self] in
            try? await Task.sleep(until: deadline, clock: .continuous)
            guard !Task.isCancelled else { return }
            self?.dropWaiter(id, refusal: .timeout)
          }
        }
        waiters.append(
          Waiter(id: id, entry: entry, continuation: continuation, expiry: expiry))
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.dropWaiter(id, refusal: .cancelled) }
    }
    switch result {
    case .success(let claim):
      if Task.isCancelled {
        claim.release()
        throw .cancelled
      }
      return claim
    case .failure(let refusal):
      recordRefusal(entry: entry, code: Self.refusalCode(refusal))
      throw refusal
    }
  }

  func setBackgroundAdmission(_ admission: BackgroundAdmission) {
    guard admission != backgroundAdmission else { return }
    backgroundAdmission = admission
    if redecideWaiters() {
      onChange?()
      onLiveProbeChange?()
    }
  }

  fileprivate func release(_ id: UInt64) {
    guard let index = held.firstIndex(where: { $0.id == id }) else { return }
    let removed = held.remove(at: index)
    let durationMs = Self.elapsedMs(from: removed.grantedAt, to: .now)
    recordRing(
      entry: removed.entry, eventKind: 2,
      outcome: durationMs > Self.wedgedThresholdMs ? 2 : 0,
      heldMs: durationMs, errorCode: 0)
    redecideWaiters()
    onChange?()
    onLiveProbeChange?()
  }

  private func decide(_ entry: ClaimEntry, ahead: [ClaimEntry]) -> ClaimDecision {
    ResourceClaimPlan.decide(
      entry.resources, for: entry.owner, held: held.map(\.entry), queuedAhead: ahead,
      admission: backgroundAdmission, escalation: entry.escalation)
  }

  private func grant(_ entry: ClaimEntry, id: UInt64) -> ResourceClaim {
    held.append((id, entry, .now))
    recordRing(entry: entry, eventKind: 1, outcome: 0, heldMs: 0, errorCode: 0)
    return ResourceClaim(id: id, entry: entry, arbiter: self)
  }

  private func nextID() -> UInt64 {
    lastID += 1
    return lastID
  }

  private func dropWaiter(_ id: UInt64, refusal: ClaimRefusal) {
    guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
    let waiter = waiters.remove(at: index)
    waiter.expiry?.cancel()
    waiter.continuation.resume(returning: .failure(refusal))
    if redecideWaiters() {
      onChange?()
      onLiveProbeChange?()
    }
  }

  @discardableResult
  private func redecideWaiters() -> Bool {
    var remaining: [Waiter] = []
    var settled: [(Waiter, Result<ResourceClaim, ClaimRefusal>)] = []
    for waiter in waiters {
      switch decide(waiter.entry, ahead: remaining.map(\.entry)) {
      case .grant: settled.append((waiter, .success(grant(waiter.entry, id: waiter.id))))
      case .refuse(let refusal): settled.append((waiter, .failure(refusal)))
      case .wait: remaining.append(waiter)
      }
    }
    waiters = remaining
    var granted = false
    for (waiter, result) in settled {
      if case .success = result { granted = true }
      waiter.expiry?.cancel()
      waiter.continuation.resume(returning: result)
    }
    return granted
  }

  @inline(__always)
  private func recordRefusal(entry: ClaimEntry, code: Int32) {
    recordRing(entry: entry, eventKind: 3, outcome: 2, heldMs: 0, errorCode: code)
  }

  @inline(__always)
  private func recordRing(
    entry: ClaimEntry, eventKind: UInt8, outcome: UInt8, heldMs: UInt32, errorCode: Int32
  ) {
    guard let decisionRing else { return }
    var item = CaptureAndArbiterEntry()
    item.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    item.ownerSummary = InlineText64(truncatingUTF8: Self.compactOwnerTag(entry.owner))
    item.heldDurationMs = heldMs
    item.errorCode = errorCode
    item.eventKind = eventKind
    item.outcome = outcome
    item.resourceMask = Self.resourceBitmask(entry.resources)
    item.flags = entry.escalation ? 2 : 0
    decisionRing.append(item)
  }

  static func compactOwnerTag(_ owner: ClaimOwner) -> String {
    switch owner {
    case .user(let feature, _):
      switch feature {
      case .textWrite: "user:textWrite"
      case .copySelection: "user:copySelection"
      case .clipboardWrite: "user:clipboardWrite"
      case .screenshot: "user:screenshot"
      case .systemPanel: "user:systemPanel"
      case .screenRecording: "user:screenRecording"
      }
    case .computer:
      "computer:operation"
    }
  }

  private static func resourceTag(_ resource: DeviceResource) -> String {
    switch resource {
    case .interactiveScreen: "interactiveScreen"
    case .globalInput: "globalInput"
    case .clipboard: "clipboard"
    case .process: "process"
    case .page: "page"
    }
  }

  private static func resourceBitmask(_ resources: Set<DeviceResource>) -> UInt8 {
    var mask: UInt8 = 0
    for resource in resources {
      switch resource {
      case .interactiveScreen: mask |= 1 << 0
      case .globalInput: mask |= 1 << 1
      case .clipboard: mask |= 1 << 2
      case .process: mask |= 1 << 3
      case .page: mask |= 1 << 4
      }
    }
    return mask
  }

  private static func refusalCode(_ refusal: ClaimRefusal) -> Int32 {
    switch refusal {
    case .busy: 1
    case .interactiveScreen: 2
    case .reentrant: 3
    case .outOfOrder: 4
    case .admissionClosed: 5
    case .timeout: 6
    case .cancelled: 7
    }
  }

  private static func elapsedMs(
    from start: ContinuousClock.Instant, to end: ContinuousClock.Instant
  )
    -> UInt32
  {
    let d = start.duration(to: end)
    let ms =
      Double(d.components.seconds) * 1_000.0
      + Double(d.components.attoseconds) / 1_000_000_000_000_000.0
    return UInt32(clamping: max(0, Int(ms.rounded())))
  }
}

/// A granted set of resources.
final class ResourceClaim {
  let id: UInt64
  let owner: ClaimOwner
  let resources: Set<DeviceResource>
  private weak var arbiter: DeviceArbiter?
  private(set) var isReleased = false

  fileprivate init(id: UInt64, entry: ClaimEntry, arbiter: DeviceArbiter) {
    self.id = id
    owner = entry.owner
    resources = entry.resources
    self.arbiter = arbiter
  }

  func release() {
    guard !isReleased else { return }
    isReleased = true
    arbiter?.release(id)
  }
}
