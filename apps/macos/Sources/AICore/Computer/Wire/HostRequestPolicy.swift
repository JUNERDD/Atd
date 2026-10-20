import Foundation

/// The checks the computer host runs on every request before it acts (plan §6.1, §6.4), kept pure
/// so the coordinator only applies their answers.
public enum HostRequestPolicy {
  /// nil when `identity` addresses this host as it is now: its id, and its current generation
  /// (nil while it holds no lock, when nothing is addressed to it). Otherwise the error the
  /// request is answered with; nothing was dispatched for it.
  public static func verify(
    _ identity: HostIdentityWire, hostId: String, generation: Int?
  ) -> ComputerErrorWire? {
    guard let generation else {
      return ComputerErrorWire(
        code: .locked, message: "Another Atd instance holds the computer host lock.")
    }
    guard identity.hostId == hostId else {
      return ComputerErrorWire(code: .hostUnavailable, message: "The request names another host.")
    }
    guard identity.hostGeneration == generation else {
      return ComputerErrorWire(
        code: .hostUnavailable,
        message:
          "The request names host generation \(identity.hostGeneration); this host is generation \(generation)."
      )
    }
    return nil
  }

  /// The continuous-clock instant of a wall-clock `deadline`, as of `now` / `clockNow`. A missing
  /// deadline counts as already passed.
  public static func instant(
    for deadline: Date?, now: Date, clockNow: ContinuousClock.Instant
  ) -> ContinuousClock.Instant {
    guard let deadline else { return clockNow }
    let seconds = max(0, deadline.timeIntervalSince(now))
    return clockNow + .milliseconds(Int64((seconds * 1000).rounded(.down)))
  }

  /// What to do with an `act` whose action id the journal or this process already knows; the
  /// service may resend a request after a reconnect, and the same action must never run twice.
  public enum Repeat: Equatable, Sendable {
    /// Unknown here: run it.
    case run
    /// Settled before: answer with the recorded result.
    case replay(ActionResultWire)
    /// Running in this process now: answer when it ends.
    case join
    /// Known without a readable result (left open by an earlier host, or its result unreadable):
    /// never run it again; answer that its effect is unknown.
    case unknown
    /// The id belongs to another run or operation.
    case conflict
  }

  public static func repeatDecision(
    actionId: String, runId: String, operationId: String, journal: HostJournalEntry?,
    inFlight: Bool
  ) -> Repeat {
    if inFlight { return .join }
    guard let journal else { return .run }
    guard journal.runId == runId, journal.operationId == operationId else { return .conflict }
    let record = HostActionRecordWire(journal)
    if let result = record.result { return .replay(result) }
    return .unknown
  }
}

/// The service processes this host has heard from, by `serviceEpoch`. A request from a new
/// epoch means the service restarted: work of the older epoch can no longer reach a run that
/// waits for it, so the host stops it before its next step.
public struct ServiceEpochTracker: Sendable {
  public enum Change: Equatable, Sendable {
    case same
    case first
    case changed(previous: String)
  }

  public private(set) var current: String?

  public init() {}

  public mutating func observe(_ epoch: String) -> Change {
    defer { current = epoch }
    guard let current else { return .first }
    return current == epoch ? .same : .changed(previous: current)
  }
}

/// The runs and operations the service cancelled, which admit nothing more (plan §6.4). Bounded:
/// the oldest entries drop out first, long after their runs ended.
public struct CancelledRuns: Sendable {
  public static let capacity = 512

  private var runs: [String: ComputerCancelReason] = [:]
  private var operations: [String: Set<String>] = [:]
  private var order: [String] = []

  public init() {}

  /// Records a `computer.cancel`: the whole run, or one operation of it.
  public mutating func cancel(runId: String, operationId: String?, reason: ComputerCancelReason) {
    if !order.contains(runId) { order.append(runId) }
    if let operationId {
      operations[runId, default: []].insert(operationId)
    } else {
      runs[runId] = reason
    }
    while order.count > Self.capacity {
      let dropped = order.removeFirst()
      runs[dropped] = nil
      operations[dropped] = nil
    }
  }

  public func isCancelled(runId: String, operationId: String) -> Bool {
    runs[runId] != nil || operations[runId]?.contains(operationId) == true
  }

  /// Whether `cancel(runId:operationId:)` with these values covers an operation.
  public static func covers(
    runId: String, operationId: String?, target: (runId: String, operationId: String)
  ) -> Bool {
    target.runId == runId && (operationId == nil || operationId == target.operationId)
  }
}
