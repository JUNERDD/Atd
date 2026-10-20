import AICore
import Foundation

/// The one owner of this Mac's device resources inside the shell (D6, plan §6.2): every native
/// writer, the computer host's engines and the shell's own features alike, claims the
/// ``DeviceResource``s its effect touches here before it starts. ``ResourceClaimPlan`` decides
/// each claim from what is held and what waits; the arbiter applies the decision, queues waiters
/// in arrival order and re-decides them whenever a claim is released, a waiter leaves or
/// background admission changes.
///
/// A claim is held until its owner calls ``ResourceClaim/release()`` after the effect converged
/// (a paste confirmed and the pasteboard restored, a dispatched step settled): nothing releases
/// it on a timer, and a deadline bounds only the wait for it. The shell's synchronous paths use
/// ``tryClaim(_:owner:)``, which refuses where a claim would wait, as their busy flags did.
///
/// It arbitrates this process only; the host lock (``ComputerHostLock``) decides which Atd
/// process may run background writes at all, which reaches the arbiter as
/// ``backgroundAdmission``.
final class DeviceArbiter {
  private struct Waiter {
    let id: UInt64
    let entry: ClaimEntry
    let continuation: CheckedContinuation<Result<ResourceClaim, ClaimRefusal>, Never>
    let expiry: Task<Void, Never>?
  }

  /// How long a user feature's asynchronous claim waits behind background claims; it never waits
  /// behind another user feature (``ResourceClaimPlan``).
  static let userWait: Duration = .seconds(1)

  private var held: [(id: UInt64, entry: ClaimEntry)] = []
  private var waiters: [Waiter] = []
  private var lastID: UInt64 = 0
  /// Closed until the computer host has the lock and its journal is reconciled.
  private(set) var backgroundAdmission: BackgroundAdmission = .closed(.hostNotHeld)
  /// Told after any claim is granted or released, for the computer host to notice the user
  /// taking the interactive screen.
  var onChange: (() -> Void)?

  /// The claims granted now, oldest first.
  var heldClaims: [ClaimEntry] { held.map(\.entry) }

  func isHeld(_ resource: DeviceResource) -> Bool {
    held.contains { $0.entry.resources.contains(resource) }
  }

  /// The claim at once, or the refusal: one that would wait is refused as ``ClaimRefusal/busy(_:)``.
  func tryClaim(_ resources: Set<DeviceResource>, owner: ClaimOwner) throws(ClaimRefusal)
    -> ResourceClaim
  {
    let entry = ClaimEntry(owner: owner, resources: resources)
    switch decide(entry, ahead: waiters.map(\.entry)) {
    case .grant:
      defer { onChange?() }
      return grant(entry, id: nextID())
    case .wait(let resource): throw .busy(resource)
    case .refuse(let refusal): throw refusal
    }
  }

  /// The claim once nothing blocks it; ``ClaimRefusal/timeout`` when `deadline` passes first,
  /// ``ClaimRefusal/cancelled`` when the calling task is cancelled meanwhile, or the plan's
  /// refusal, which can also come while it waits (background admission closing, the user taking
  /// the interactive screen).
  func claim(
    _ resources: Set<DeviceResource>, owner: ClaimOwner, deadline: ContinuousClock.Instant?
  ) async throws(ClaimRefusal) -> ResourceClaim {
    guard !Task.isCancelled else { throw .cancelled }
    let entry = ClaimEntry(owner: owner, resources: resources)
    switch decide(entry, ahead: waiters.map(\.entry)) {
    case .grant:
      defer { onChange?() }
      return grant(entry, id: nextID())
    case .refuse(let refusal): throw refusal
    case .wait: break
    }
    if let deadline, deadline <= .now { throw .timeout }
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
    let claim = try result.get()
    // Granted as the task was cancelled: nothing ran under it yet, so it goes back.
    if Task.isCancelled {
      claim.release()
      throw .cancelled
    }
    return claim
  }

  /// Opens or closes background (computer) claims. Closing refuses waiting background claims at
  /// once; granted ones stay until their owners release them.
  func setBackgroundAdmission(_ admission: BackgroundAdmission) {
    guard admission != backgroundAdmission else { return }
    backgroundAdmission = admission
    if redecideWaiters() { onChange?() }
  }

  /// Called by ``ResourceClaim/release()`` only.
  fileprivate func release(_ id: UInt64) {
    guard let index = held.firstIndex(where: { $0.id == id }) else { return }
    held.remove(at: index)
    redecideWaiters()
    onChange?()
  }

  private func decide(_ entry: ClaimEntry, ahead: [ClaimEntry]) -> ClaimDecision {
    ResourceClaimPlan.decide(
      entry.resources, for: entry.owner, held: held.map(\.entry), queuedAhead: ahead,
      admission: backgroundAdmission)
  }

  /// Records the claim as held; callers tell ``onChange`` once their state is consistent.
  private func grant(_ entry: ClaimEntry, id: UInt64) -> ResourceClaim {
    held.append((id, entry))
    return ResourceClaim(id: id, entry: entry, arbiter: self)
  }

  private func nextID() -> UInt64 {
    lastID += 1
    return lastID
  }

  /// A waiter that timed out or was cancelled leaves the queue, which may unblock those behind.
  private func dropWaiter(_ id: UInt64, refusal: ClaimRefusal) {
    guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
    let waiter = waiters.remove(at: index)
    waiter.expiry?.cancel()
    waiter.continuation.resume(returning: .failure(refusal))
    if redecideWaiters() { onChange?() }
  }

  /// Decides every waiter again in arrival order, each against the claims held by then and the
  /// waiters still ahead of it; true when it granted any.
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
}

/// A granted set of resources. Its owner releases it once the effect it guards converged;
/// nothing else does, so an owner must release it on every path (a `defer` where the effect ends
/// in scope). Releasing again does nothing.
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
