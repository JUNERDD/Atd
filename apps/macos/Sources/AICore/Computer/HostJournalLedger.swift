import Foundation

/// One line of the host journal (`hostjournal.jsonl` beside the computer host lock): an action's
/// phase as the host recorded it. It names the action, its run and operation and the host
/// generation that wrote it, and carries the result only once there is one, as opaque JSON; no
/// task content, page text or typed values.
public struct HostJournalEntry: Codable, Equatable, Sendable {
  public var actionId: String
  public var runId: String
  public var operationId: String
  public var hostGeneration: Int
  public var phase: OperationPhase
  /// The action's result as the host reported it, once settled; opaque to the journal.
  public var result: JSONValue?
  /// ISO 8601 with fractional seconds, UTC.
  public var at: String

  public init(
    actionId: String, runId: String, operationId: String, hostGeneration: Int,
    phase: OperationPhase, result: JSONValue? = nil, at: Date
  ) {
    self.actionId = actionId
    self.runId = runId
    self.operationId = operationId
    self.hostGeneration = hostGeneration
    self.phase = phase
    self.result = result
    self.at = Self.timestamp(at)
  }

  public static func timestamp(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .gmt))
  }
}

/// The journal folded to each action's latest entry, in the order actions last changed. The
/// host keeps it in memory, appends through it so an entry that skips or reverses a phase is
/// never written, and compacts the file from it.
public struct HostJournalLedger: Sendable {
  public enum Rejection: Error, Equatable, Sendable {
    /// The entry's phase cannot follow the action's latest one (``OperationPhase/canAdvance(to:)``),
    /// or a new action does not start at ``OperationPhase/intent``.
    case illegalTransition(actionId: String, from: OperationPhase?, to: OperationPhase)
    /// The entry names another run or operation than the action's first entry did.
    case identityChanged(actionId: String)
  }

  private var latest: [String: HostJournalEntry] = [:]
  private var sequence: [String: Int] = [:]
  private var counter = 0

  public init() {}

  /// Folds `entries` read back from the file in order, skipping any that could not have been
  /// appended (a duplicated or out-of-order line). An action's first entry may be in any phase,
  /// since a compacted file keeps only each action's latest one.
  public init(replaying entries: [HostJournalEntry]) {
    for entry in entries { try? take(entry, startingAnywhere: true) }
  }

  /// Takes `entry` as its action's latest, or rejects it without changing anything.
  public mutating func apply(_ entry: HostJournalEntry) throws(Rejection) {
    try take(entry, startingAnywhere: false)
  }

  private mutating func take(_ entry: HostJournalEntry, startingAnywhere: Bool)
    throws(Rejection)
  {
    let previous = latest[entry.actionId]
    if let previous {
      guard previous.runId == entry.runId, previous.operationId == entry.operationId else {
        throw .identityChanged(actionId: entry.actionId)
      }
      guard previous.phase.canAdvance(to: entry.phase) else {
        throw .illegalTransition(actionId: entry.actionId, from: previous.phase, to: entry.phase)
      }
    } else if !startingAnywhere, entry.phase != .initial {
      throw .illegalTransition(actionId: entry.actionId, from: nil, to: entry.phase)
    }
    counter += 1
    latest[entry.actionId] = entry
    sequence[entry.actionId] = counter
  }

  /// Whether `entry` would be taken by ``apply(_:)``.
  public func accepts(_ entry: HostJournalEntry) -> Bool {
    var copy = self
    return (try? copy.apply(entry)) != nil
  }

  public func entry(for actionId: String) -> HostJournalEntry? { latest[actionId] }

  /// Every action whose effect is still open, oldest change first.
  public var unsettled: [HostJournalEntry] { ordered.filter(\.phase.isUnsettled) }

  /// The highest host generation any entry names; 0 for an empty journal.
  public var maxGeneration: Int { latest.values.map(\.hostGeneration).max() ?? 0 }

  public var count: Int { latest.count }

  /// What a compacted journal keeps, in order: the latest entry of every unsettled action, and of
  /// the `keepingSettled` most recently settled ones. Older settled actions drop out; an
  /// unsettled one never does.
  public func compacted(keepingSettled: Int) -> [HostJournalEntry] {
    let all = ordered
    let settled = all.filter { !$0.phase.isUnsettled }
    let kept = Set(settled.suffix(max(0, keepingSettled)).map(\.actionId))
    return all.filter { $0.phase.isUnsettled || kept.contains($0.actionId) }
  }

  private var ordered: [HostJournalEntry] {
    latest.values.sorted { (sequence[$0.actionId] ?? 0) < (sequence[$1.actionId] ?? 0) }
  }
}

/// The unsettled marker (`unsettled.json` beside the host lock): the actions a host generation
/// left open, and that generation, with no task content. A host that finds a marker it did not
/// write keeps background writes closed until those actions are reconciled, whatever data
/// directory either instance used.
public struct UnsettledMarker: Codable, Equatable, Sendable {
  public var hostGeneration: Int
  public var actionIds: [String]

  public init(hostGeneration: Int, actionIds: [String]) {
    self.hostGeneration = hostGeneration
    self.actionIds = actionIds
  }
}
