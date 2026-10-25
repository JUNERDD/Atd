import AICore
import Foundation

/// The live surfaces of a native target (plan §2.2): listed afresh from accessibility and the
/// window server before each observation and each write, attributed by
/// ``NativeSurfaceOwnership``, kept by ``NativeSurfaceSet``. A surface that closed takes its
/// observation and captures with it; the root window closing ends the ref. These reads are the
/// shell's own, off the main actor; input only ever goes through the driver.
extension NativeEngine {
  /// Lists the target's surfaces again and returns them. Facts that cannot be read (a busy app)
  /// leave the listing as it was rather than closing what the host cannot see.
  @discardableResult
  func refreshSurfaces(_ ref: TargetRefWire) async throws(ComputerFailure) -> NativeSurfaceSet {
    let (pid, rootId) = try window(of: ref)
    let start = ref.native?.processStart ?? ""
    let (facts, ids) = await NativeTargetProbe.detached {
      (
        NativeSurfaceProbe.facts(pid: pid_t(pid), processStart: start),
        NativeSurfaceProbe.windowIds(of: pid_t(pid))
      )
    }
    guard var target = targets[ref.id], target.ref == ref else { throw Self.changed }
    guard ids.contains(rootId) else {
      targets[ref.id] = nil
      throw ComputerFailure(.targetChanged, "The target's window closed; list targets again.")
    }
    let candidates = NativeSurfaceOwnership.candidates(
      facts, rootWindowId: rootId, acted: target.acted,
      opened: ids.subtracting(target.knownWindows))
    guard !candidates.isEmpty, let removed = target.surfaces.reconcile(candidates) else {
      return target.surfaces
    }
    target.knownWindows = ids
    target.acted = false
    let gone = Set(removed)
    if let observed = target.observed?.surfaceRefId, gone.contains(observed) {
      target.observation = nil
      target.observed = nil
    }
    target.captures.removeAll { $0.surfaceRefId.map(gone.contains) == true }
    targets[ref.id] = target
    return target.surfaces
  }

  /// Where surface `id` (nil or the root's id: the root) is read now; `staleObservation` when
  /// it is no longer listed or its process is not the one that showed it.
  func surfaceRead(_ ref: TargetRefWire, _ id: String?) throws(ComputerFailure)
    -> NativeSurfaceRead
  {
    let root = try rootRead(ref)
    guard let target = targets[ref.id] else { throw Self.changed }
    guard let id, id != target.surfaces.root.id else { return root }
    guard let entry = target.surfaces.entry(id) else { throw Self.surfaceGone }
    let candidate = entry.candidate
    if candidate.pid != root.pid,
      NativeTargetProbe.processStart(pid: pid_t(candidate.pid)).map(String.init)
        != candidate.processStart
    {
      throw Self.surfaceGone
    }
    let own = candidate.windowId != nil && candidate.windowId == candidate.readWindowId
    return NativeSurfaceRead(
      surfaceRefId: id, pid: candidate.readPid, windowId: candidate.readWindowId,
      root: own ? .window : .element(role: candidate.role, frame: candidate.frame),
      cropFrame: own ? nil : candidate.frame)
  }

  /// Refuses a write to surface `id` while a modal surface over it is open (a sheet on its
  /// window, a modal dialog of its app): the write would land in the blocked window, or be
  /// swallowed. The person or the model acts in the modal surface instead.
  func requireUnblocked(_ ref: TargetRefWire, surface id: String?) async throws(ComputerFailure) {
    let surfaces = try await refreshSurfaces(ref)
    guard surfaces.entry(id) != nil else { throw Self.surfaceGone }
    if let blocker = surfaces.modalBlocker(of: id) {
      let title = blocker.candidate.title.map { " “\($0)”" } ?? ""
      throw ComputerFailure(
        .modalBlocked,
        "A modal \(blocker.candidate.kind.rawValue)\(title) is open over this surface; observe "
          + "it (surfaceRefId \(blocker.id)) and act there.")
    }
  }

  static let surfaceGone = ComputerFailure(
    .staleObservation, "The surface closed or changed; observe the target again.")
}
