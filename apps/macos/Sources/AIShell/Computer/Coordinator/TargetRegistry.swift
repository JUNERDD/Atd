import AICore
import AppKit

/// The target refs this host generation resolved, with the binding each came from, the latest
/// observation of each and the runs that resolved it (plan §5, §6.3). A ref is valid only while
/// it is the one recorded here and its engine still runs the generation that minted it; an engine
/// restart, the target app quitting, a navigation and the person using the target each invalidate
/// what they touch, and the model must resolve or observe again.
///
/// Which runs resolved a ref outlives its validity: an engine may have prepared the target for it
/// (occlusion keep-alive), which it undoes once no run uses the ref any more (``endRun(_:)``,
/// ``release(refId:)``, ``releaseAll()``), whatever became of the ref meanwhile.
final class TargetRegistry {
  struct Entry {
    let binding: TargetBindingWire
    let ref: TargetRefWire
    /// The latest observation without its screenshot; nil until observed, or once a step made it
    /// stale or the person was found using the target (`targetInUse`).
    var observation: ObservationWire?
  }

  /// A ref and the live runs that resolved it.
  private struct Use {
    var ref: TargetRefWire
    var runs: Set<String>
  }

  private var entries: [String: Entry] = [:]
  private var uses: [String: Use] = [:]
  /// The app-quit observer; the registry lives as long as the shell, so it is never removed.
  private var terminations: (any NSObjectProtocol)?

  init(workspace: NSWorkspace = .shared) {
    terminations = workspace.notificationCenter.addObserver(
      forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let pid = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?
        .processIdentifier
      MainActor.assumeIsolated { if let pid { self?.processEnded(pid) } }
    }
  }

  /// Records a ref `runId` freshly resolved; older refs of the same binding go.
  func record(_ ref: TargetRefWire, binding: TargetBindingWire, runId: String) {
    entries = entries.filter { $0.value.binding.bindingId != binding.bindingId }
    entries[ref.id] = Entry(binding: binding, ref: ref)
    uses[ref.id] = Use(ref: ref, runs: (uses[ref.id]?.runs ?? []).union([runId]))
  }

  /// The entry of a ref the service passed back whole: it must be exactly the recorded one, and
  /// its engine must still run the generation that minted it.
  func current(_ ref: TargetRefWire, engineGeneration: Int?) throws(ComputerFailure) -> Entry {
    let entry = try current(id: ref.id, engineGeneration: engineGeneration)
    guard entry.ref == ref else { throw Self.changed }
    return entry
  }

  /// The entry of a ref named by id (an action's `targetRefId`).
  func current(id: String, engineGeneration: Int?) throws(ComputerFailure) -> Entry {
    guard let entry = entries[id] else { throw Self.changed }
    guard entry.ref.engineGeneration == engineGeneration else {
      entries[id] = nil
      throw ComputerFailure(
        .targetChanged, "The engine restarted since the target was resolved; list targets again.")
    }
    return entry
  }

  /// The kind of a recorded ref's target, which decides its engine and the grants it needs.
  func kind(of refId: String) throws(ComputerFailure) -> ComputerTargetKind {
    guard let entry = entries[refId] else { throw Self.changed }
    return entry.binding.kind
  }

  func observed(_ observation: ObservationWire, refId: String) {
    entries[refId]?.observation = observation.withoutScreenshot
  }

  /// The latest observation is stale: a step changed the target (a navigation, a DOM identity
  /// change), or the person was found using it.
  func invalidateObservation(refId: String) {
    entries[refId]?.observation = nil
  }

  /// The ref no longer names its target (the engine said so, or the service released it).
  func invalidate(refId: String) {
    entries[refId] = nil
  }

  /// Every ref of an engine, after the engine stopped.
  func invalidate(engine: ComputerEngineID) {
    entries = entries.filter { $0.value.ref.engine != engine }
  }

  func removeAll() { entries = [:] }

  // MARK: Runs

  /// The run ended: the refs no other live run resolved, whose preparation now goes.
  func endRun(_ runId: String) -> [TargetRefWire] {
    var released: [TargetRefWire] = []
    for (id, use) in uses where use.runs.contains(runId) {
      let rest = use.runs.subtracting([runId])
      if rest.isEmpty {
        uses[id] = nil
        released.append(use.ref)
      } else {
        uses[id]?.runs = rest
      }
    }
    return released
  }

  /// The service released the ref (its run let go of it, or its binding was deleted), so no run
  /// uses it any more.
  func release(refId: String) {
    uses[refId] = nil
  }

  /// Every ref a live run still uses, for the host's quit or a service restart, after which no
  /// run of before reaches this host.
  func releaseAll() -> [TargetRefWire] {
    defer { uses = [:] }
    return uses.values.map(\.ref)
  }

  /// A native target's app quit: its refs name a process that is gone.
  private func processEnded(_ pid: pid_t) {
    entries = entries.filter { $0.value.ref.native?.pid != Int(pid) }
  }

  private static let changed = ComputerFailure(
    .targetChanged, "The target ref is not current on this host; list targets again.")
}
