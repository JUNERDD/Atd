import Foundation

/// `ComputerEvidenceSchema`: a piece of evidence an action left.
public struct ComputerEvidenceWire: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case value, text, url, file, screenshot
  }

  public let kind: Kind
  public let summary: String
  public let resourceId: String?

  public init(kind: Kind, summary: String, resourceId: String? = nil) {
    self.kind = kind
    self.summary = summary.wireClipped(500)
    self.resourceId = resourceId
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    kind = try container.value(.kind, Kind.self)
    summary = try container.string(.summary, maxLength: 500)
    resourceId = try container.optional(.resourceId) { try container.identifier($0) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case kind, summary, resourceId }
}

/// One file an action downloaded, saved by the browser worker in the run's download directory
/// (`<dataDir>/computer/downloads/<runId>/`). The service imports it as a task resource and
/// deletes the staged file; it accepts only a real path inside that directory.
public struct ComputerDownloadWire: Codable, Equatable, Sendable {
  public let name: String
  public let path: String
  public let bytes: Int
  public let mime: String?

  public init(name: String, path: String, bytes: Int, mime: String? = nil) {
    self.name = name.wireClipped(255)
    self.path = path
    self.bytes = max(0, bytes)
    self.mime = mime.map { $0.wireClipped(255) }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    name = try container.string(.name, minLength: 1, maxLength: 255)
    path = try container.string(.path, minLength: 2, maxLength: 4096, pattern: "^/")
    bytes = try container.integer(.bytes, minimum: 0)
    mime = try container.optional(.mime) { try container.string($0, minLength: 1, maxLength: 255) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case name, path, bytes, mime }
}

/// `ActionResultSchema`: what one action did. See ``ActionResultFold`` for how the host derives
/// `dispatch`, `effect` and `retry` from its step outcomes. Decoding reads a result the host
/// journaled before protocol 8 as today's: retired error codes map (``ComputerErrorCode/retired``)
/// and the retired `foreground` delivery reads as none, so `status` can still answer with it.
public struct ActionResultWire: Codable, Equatable, Sendable {
  public enum Dispatch: String, Codable, Sendable {
    case notDispatched = "not_dispatched"
    case dispatched
    case settled
  }

  public enum Effect: String, Codable, Sendable {
    case none, partial, unknown, verified
  }

  public enum Retry: String, Codable, Sendable {
    case safe
    case never
    case afterReview = "after_review"
  }

  /// `ComputerRouteSchema`: the route an action takes to its target: the accessibility API,
  /// synthesized input events posted to the target process, a menu command, an app script the host
  /// owns, or CDP. The host picks it per step; a result reports the route that ran, a target
  /// capability (``TargetCapabilityWire/routes``) the ones available.
  public enum Route: String, Codable, CaseIterable, Sendable {
    case accessibility, events, menu, script, cdp
  }

  public let actionId: String
  public let dispatch: Dispatch
  public let effect: Effect
  public let completedSteps: Int
  public let stoppedAt: Int?
  public let error: ComputerErrorWire?
  public let evidence: [ComputerEvidenceWire]
  public let retry: Retry
  public let invalidated: String?
  /// How the input was actually delivered, when any was.
  public let delivery: ComputerDelivery?
  /// The route the action's input actually took.
  public let route: Route?
  /// What the host's guard saw change for the person while the action ran, when anything did.
  public let disturbances: [ComputerDisturbanceWire]?
  /// The files the action downloaded, when any.
  public let downloads: [ComputerDownloadWire]?

  public init(
    actionId: String, dispatch: Dispatch, effect: Effect, completedSteps: Int, stoppedAt: Int?,
    error: ComputerErrorWire?, evidence: [ComputerEvidenceWire], retry: Retry,
    invalidated: String?, delivery: ComputerDelivery? = nil, route: Route? = nil,
    disturbances: [ComputerDisturbanceWire]? = nil, downloads: [ComputerDownloadWire]? = nil
  ) {
    self.actionId = actionId
    self.dispatch = dispatch
    self.effect = effect
    self.completedSteps = min(max(completedSteps, 0), ComputerWireLimits.maxSteps)
    self.stoppedAt = stoppedAt.map { min(max($0, 0), ComputerWireLimits.maxSteps - 1) }
    self.error = error
    self.evidence = Array(evidence.prefix(ComputerWireLimits.maxEvidence))
    self.retry = retry
    self.invalidated = invalidated.map { $0.wireClipped(500) }
    self.delivery = delivery
    self.route = route
    self.disturbances = disturbances.flatMap {
      $0.isEmpty ? nil : Array($0.prefix(ComputerWireLimits.maxDisturbances))
    }
    self.downloads = downloads.flatMap {
      $0.isEmpty ? nil : Array($0.prefix(ComputerWireLimits.maxDownloads))
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    actionId = try container.actionId(.actionId)
    dispatch = try container.value(.dispatch, Dispatch.self)
    effect = try container.value(.effect, Effect.self)
    completedSteps = try container.integer(
      .completedSteps, minimum: 0, maximum: ComputerWireLimits.maxSteps)
    stoppedAt = try container.optional(.stoppedAt) {
      try container.integer($0, minimum: 0, maximum: ComputerWireLimits.maxSteps - 1)
    }
    error = try container.optional(.error) { try container.value($0, ComputerErrorWire.self) }
    evidence = try container.array(
      .evidence, of: ComputerEvidenceWire.self, maxItems: ComputerWireLimits.maxEvidence)
    retry = try container.value(.retry, Retry.self)
    invalidated = try container.optional(.invalidated) {
      try container.string($0, maxLength: 500)
    }
    delivery = try Self.delivery(container)
    route = try container.optional(.route) { try container.value($0, Route.self) }
    disturbances = try container.optional(.disturbances) {
      try container.array(
        $0, of: ComputerDisturbanceWire.self, maxItems: ComputerWireLimits.maxDisturbances)
    }
    downloads = try container.optional(.downloads) {
      try container.array(
        $0, of: ComputerDownloadWire.self, maxItems: ComputerWireLimits.maxDownloads)
    }
  }

  /// `delivery`, where the `foreground` a result journaled before protocol 8 may name reads as
  /// none: that fact is retired, and the rest of the result still holds.
  private static func delivery(_ container: KeyedDecodingContainer<CodingKeys>) throws
    -> ComputerDelivery?
  {
    guard container.contains(.delivery),
      try container.decode(String.self, forKey: .delivery) != "foreground"
    else { return nil }
    return try container.value(.delivery, ComputerDelivery.self)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case actionId, dispatch, effect, completedSteps, stoppedAt, error, evidence, retry
    case invalidated, delivery, route, disturbances, downloads
  }
}

/// `ComputerActionPhaseSchema`: the phases a journal record reports on the wire. The host's own
/// ``OperationPhase/unknown`` has no wire phase; ``HostActionRecordWire/init(_:)`` reports it as
/// `dispatched` without a result, which the service treats as unresolved.
public enum ComputerActionPhase: String, Codable, Sendable {
  case intent
  case dispatched
  case settled
}

/// `HostActionRecordSchema`: one host journal entry as `status` answers it.
public struct HostActionRecordWire: Codable, Equatable, Sendable {
  public let actionId: String
  public let runId: String
  public let operationId: String
  public let hostGeneration: Int
  public let phase: ComputerActionPhase
  public let result: ActionResultWire?
  public let at: String

  /// The record of a journal entry. A settled entry whose stored result no longer decodes is
  /// reported as dispatched without a result, so the service keeps it unresolved rather than
  /// trusting a result the host cannot read back.
  public init(_ entry: HostJournalEntry) {
    actionId = entry.actionId
    runId = entry.runId
    operationId = entry.operationId
    hostGeneration = entry.hostGeneration
    at = entry.at
    let decoded = entry.result.flatMap { value in
      (try? JSONEncoder().encode(value)).flatMap {
        try? JSONDecoder().decode(ActionResultWire.self, from: $0)
      }
    }
    switch entry.phase {
    case .intent: (phase, result) = (.intent, nil)
    case .dispatched, .unknown: (phase, result) = (.dispatched, nil)
    case .settled: (phase, result) = decoded.map { (.settled, $0) } ?? (.dispatched, nil)
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    actionId = try container.actionId(.actionId)
    runId = try container.identifier(.runId)
    operationId = try container.operationId(.operationId)
    hostGeneration = try container.integer(.hostGeneration, minimum: 1)
    phase = try container.value(.phase, ComputerActionPhase.self)
    result = try container.optional(.result) { try container.value($0, ActionResultWire.self) }
    at = try container.string(.at)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case actionId, runId, operationId, hostGeneration, phase, result, at
  }
}
