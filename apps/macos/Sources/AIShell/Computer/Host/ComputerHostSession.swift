import AICore
import Foundation
import OSLog

/// This shell's tenure as the computer host (D6, plan §6.2, §6.4): it takes the host lock, then,
/// once per held lock and in this order, opens the host journal, takes the next host generation
/// above anything the journal names, turns every action an earlier generation left open into
/// ``OperationPhase/unknown``, records them in the unsettled marker and opens background
/// admission on the ``DeviceArbiter`` only when nothing is unsettled. A shell that finds the lock
/// busy keeps background writes closed and may start again later.
///
/// The computer coordinator appends to ``journal`` as actions move on, and calls
/// ``refreshUnsettled(acknowledging:)`` once it reconciled what was open. ``stop()`` is the quit
/// path: background admission closes for good, the marker keeps whatever is still open, and the
/// lock goes.
final class ComputerHostSession {
  let lock: ComputerHostLock
  private let arbiter: DeviceArbiter
  /// This process's host generation; nil until the lock is held.
  private(set) var generation: Int?
  /// The host journal; nil until the lock is held.
  private(set) var journal: HostJournal?
  /// Actions whose effect is not known yet, which keep background writes closed.
  private(set) var unsettledActionIds: [String] = []
  /// Why the host files could not be used, when they could not; background writes stay closed.
  private(set) var failure: String?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  init(lock: ComputerHostLock, arbiter: DeviceArbiter) {
    self.lock = lock
    self.arbiter = arbiter
  }

  /// Takes the lock when it is free and prepares the host files once; true while held.
  @discardableResult
  func start() -> Bool {
    guard lock.acquire() else {
      arbiter.setBackgroundAdmission(.closed(.hostNotHeld))
      if let holder = lock.holderDescription {
        Self.log.info("The computer host lock is held by \(holder, privacy: .public).")
      }
      return false
    }
    guard generation == nil else { return true }
    do throws(ComputerHostFileError) {
      let journal = try HostJournal(holding: lock)
      let generation = try HostGeneration.advance(
        holding: lock, above: journal.ledger.maxGeneration)
      let marker = try lock.readUnsettled()
      for entry in journal.unsettled where entry.phase != .unknown {
        try? journal.append(
          HostJournalEntry(
            actionId: entry.actionId, runId: entry.runId, operationId: entry.operationId,
            hostGeneration: generation, phase: entry.phase.afterHostLoss, at: .now))
      }
      self.journal = journal
      self.generation = generation
      try record(Self.openActions(marker: marker, journal: journal, acknowledged: []))
    } catch {
      fail(error)
    }
    return true
  }

  /// Drops the actions the journal now shows settled from the unsettled set, and those in
  /// `acknowledged` that the journal does not know (a marker an earlier host wrote for actions it
  /// never journaled here) once the user reviewed them; opens background admission when nothing
  /// is left.
  func refreshUnsettled(acknowledging acknowledged: Set<String> = []) {
    guard let journal, failure == nil else { return }
    let marker = UnsettledMarker(hostGeneration: generation ?? 0, actionIds: unsettledActionIds)
    do throws(ComputerHostFileError) {
      try record(Self.openActions(marker: marker, journal: journal, acknowledged: acknowledged))
    } catch {
      fail(error)
    }
  }

  /// The quit path: nothing new is admitted, the marker keeps what is still open, the lock goes.
  func stop() {
    arbiter.setBackgroundAdmission(.closed(.stopping))
    guard lock.isHeld else { return }
    if let journal, let generation, failure == nil {
      let open = journal.unsettled.map(\.actionId)
      try? lock.writeUnsettled(UnsettledMarker(hostGeneration: generation, actionIds: open))
    }
    lock.release()
  }

  private func record(_ open: [String]) throws(ComputerHostFileError) {
    try lock.writeUnsettled(UnsettledMarker(hostGeneration: generation ?? 0, actionIds: open))
    unsettledActionIds = open
    arbiter.setBackgroundAdmission(open.isEmpty ? .open : .closed(.unsettled))
  }

  private func fail(_ error: ComputerHostFileError) {
    failure =
      switch error {
      case .lockNotHeld: "The computer host lock is not held."
      case .io(let message): message
      }
    arbiter.setBackgroundAdmission(.closed(.unsettled))
    Self.log.error("Computer host files unavailable: \(self.failure ?? "", privacy: .public)")
  }

  /// The journal's unsettled actions, then the marker's that the journal does not show settled,
  /// less those acknowledged without a journal entry.
  private static func openActions(
    marker: UnsettledMarker?, journal: HostJournal, acknowledged: Set<String>
  ) -> [String] {
    var open = journal.unsettled.map(\.actionId)
    var seen = Set(open)
    for id in marker?.actionIds ?? [] where !seen.contains(id) {
      if let entry = journal.entry(for: id) {
        if entry.phase.isUnsettled { open.append(id) }
      } else if !acknowledged.contains(id) {
        open.append(id)
      }
      seen.insert(id)
    }
    return open
  }
}
