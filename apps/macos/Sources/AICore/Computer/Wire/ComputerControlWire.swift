import Foundation

/// `ExecutionEnvelopeSchema`: who an execution is for, injected by the service on every request.
public struct ExecutionEnvelopeWire: Decodable, Equatable, Sendable {
  public let taskId: String
  public let runId: String
  public let executionId: String
  public let toolCallId: String
  public let operationId: String
  public let grantRef: ComputerGrantRefWire?
  /// Unattended runs never prompt for a system permission and need qualified engine profiles.
  public let unattended: Bool
  public let deadlineAt: String

  public init(
    taskId: String, runId: String, executionId: String, toolCallId: String, operationId: String,
    grantRef: ComputerGrantRefWire? = nil, unattended: Bool, deadlineAt: Date
  ) {
    self.taskId = taskId
    self.runId = runId
    self.executionId = executionId
    self.toolCallId = toolCallId
    self.operationId = operationId
    self.grantRef = grantRef
    self.unattended = unattended
    self.deadlineAt = ComputerWireCoding.timestamp(deadlineAt)
  }

  /// `deadlineAt` as a date; nil when it is not a date-time, which the host treats as already
  /// passed.
  public var deadline: Date? { BridgeCoding.parseDateTime(deadlineAt) }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    taskId = try container.identifier(.taskId)
    runId = try container.identifier(.runId)
    executionId = try container.string(.executionId, maxLength: 256)
    toolCallId = try container.string(.toolCallId, maxLength: 256)
    operationId = try container.operationId(.operationId)
    grantRef = try container.optional(.grantRef) {
      try container.value($0, ComputerGrantRefWire.self)
    }
    unattended = try container.boolean(.unattended)
    deadlineAt = try container.string(.deadlineAt)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case taskId, runId, executionId, toolCallId, operationId, grantRef, unattended, deadlineAt
  }
}

/// Who a request is addressed to and who answers it: the host's identity and the service process
/// (`serviceEpoch`) that sent it. A reply echoes the request's identity; the service rejects any
/// reply whose identity does not match its pending request.
public struct HostIdentityWire: Equatable, Hashable, Sendable {
  public let requestId: String
  public let hostId: String
  public let hostGeneration: Int
  public let serviceEpoch: String

  public init(requestId: String, hostId: String, hostGeneration: Int, serviceEpoch: String) {
    self.requestId = requestId
    self.hostId = hostId
    self.hostGeneration = hostGeneration
    self.serviceEpoch = serviceEpoch
  }
}

/// `HostRequestSchema`: one request to the bound host.
public struct HostRequestWire: Decodable, Equatable, Sendable {
  public let identity: HostIdentityWire
  public let envelope: ExecutionEnvelopeWire
  public let op: HostOperationWire

  public init(identity: HostIdentityWire, envelope: ExecutionEnvelopeWire, op: HostOperationWire) {
    self.identity = identity
    self.envelope = envelope
    self.op = op
  }

  public var requestId: String { identity.requestId }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    identity = HostIdentityWire(
      requestId: try container.identifier(.requestId),
      hostId: try container.identifier(.hostId),
      hostGeneration: try container.integer(.hostGeneration, minimum: 1),
      serviceEpoch: try container.identifier(.serviceEpoch))
    envelope = try container.value(.envelope, ExecutionEnvelopeWire.self)
    op = try container.value(.op, HostOperationWire.self)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case requestId, hostId, hostGeneration, serviceEpoch, envelope, op
  }
}

/// `HostReplyValueSchema`: a successful reply's value, by the operation it answers.
public enum HostReplyValueWire: Encodable, Equatable, Sendable {
  public struct Unavailable: Codable, Equatable, Sendable {
    public let bindingId: String
    public let reason: ComputerErrorCode

    public init(bindingId: String, reason: ComputerErrorCode) {
      self.bindingId = bindingId
      self.reason = reason
    }
  }

  case targets(refs: [TargetRefWire], unavailable: [Unavailable])
  case observation(ObservationWire)
  case actionResult(ActionResultWire)
  case status(records: [HostActionRecordWire])
  case released
  case accessCandidate(SaveComputerBindingRequestWire.Content)
  /// The target is open; `activated` says whether opening it made any app active anyway (a
  /// browser that had to start may take the front).
  case accessOpened(activated: Bool)
  case screenShare(ScreenShareReplyWire)
  case screenContext(sources: [ComputerVisualSourceWire], sharedSources: [ScreenCursorWire])

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .screenShare(let reply): try reply.encode(to: encoder)
    case .screenContext(let sources, let sharedSources):
      try container.encode("screenContext", forKey: .kind)
      try container.encode(sources, forKey: .sources)
      try container.encode(sharedSources, forKey: .sharedSources)
    case .targets(let refs, let unavailable):
      try container.encode("targets", forKey: .kind)
      try container.encode(refs, forKey: .refs)
      try container.encode(unavailable, forKey: .unavailable)
    case .observation(let observation):
      try container.encode("observation", forKey: .kind)
      try container.encode(observation, forKey: .observation)
    case .actionResult(let result):
      try container.encode("actionResult", forKey: .kind)
      try container.encode(result, forKey: .result)
    case .status(let records):
      try container.encode("status", forKey: .kind)
      try container.encode(records, forKey: .records)
    case .accessCandidate(let content):
      try container.encode("accessCandidate", forKey: .kind)
      try container.encode(content, forKey: .content)
    case .accessOpened(let activated):
      try container.encode("accessOpened", forKey: .kind)
      try container.encode(activated, forKey: .activated)
    case .released:
      try container.encode("released", forKey: .kind)
    }
  }

  private enum Keys: String, CodingKey {
    case kind, refs, unavailable, observation, result, records, content, sources, sharedSources
    case activated
  }
}

/// `HostReplySchema`: the host's answer to one request. An `act` that dispatched anything answers
/// `ok` with its result (which carries its own error); a failure means the operation was refused
/// or failed before any dispatch, with the same error shape and its `reason` when one applies.
public struct HostReplyWire: Encodable, Equatable, Sendable {
  public enum Outcome: Equatable, Sendable {
    case ok(HostReplyValueWire)
    case failed(ComputerErrorWire)
  }

  public let identity: HostIdentityWire
  public let outcome: Outcome

  public init(identity: HostIdentityWire, outcome: Outcome) {
    self.identity = identity
    self.outcome = outcome
  }

  public static func ok(_ request: HostRequestWire, _ value: HostReplyValueWire) -> HostReplyWire {
    HostReplyWire(identity: request.identity, outcome: .ok(value))
  }

  public static func failed(
    _ request: HostRequestWire, _ code: ComputerErrorCode, _ message: String,
    reason: ComputerRefusalReason? = nil
  ) -> HostReplyWire {
    HostReplyWire(
      identity: request.identity,
      outcome: .failed(ComputerErrorWire(code: code, message: message, reason: reason)))
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encode(identity.requestId, forKey: .requestId)
    try container.encode(identity.hostId, forKey: .hostId)
    try container.encode(identity.hostGeneration, forKey: .hostGeneration)
    try container.encode(identity.serviceEpoch, forKey: .serviceEpoch)
    switch outcome {
    case .ok(let value):
      try container.encode(true, forKey: .ok)
      try container.encode(value, forKey: .value)
    case .failed(let error):
      try container.encode(false, forKey: .ok)
      try container.encode(error, forKey: .error)
    }
  }

  private enum Keys: String, CodingKey {
    case requestId, hostId, hostGeneration, serviceEpoch, ok, value, error
  }
}

/// `ComputerCancelFrameSchema`: stop the run's work, or one operation's when `operationId` is set.
public struct ComputerCancelWire: Equatable, Sendable {
  public let runId: String
  public let operationId: String?
  public let reason: ComputerCancelReason

  public init(runId: String, operationId: String?, reason: ComputerCancelReason) {
    self.runId = runId
    self.operationId = operationId
    self.reason = reason
  }
}

/// The host part of `computer.hello`, sent after `subscribe` on every (re)connect. `protocol` is
/// always ``ComputerWireLimits/protocolVersion``: the service binds only a host that speaks its
/// own version.
public struct ComputerHelloWire: Encodable, Equatable, Sendable {
  public let protocolVersion: Int
  public let hostId: String
  public let hostGeneration: Int
  public let lockHeld: Bool
  public let profiles: [CapabilityProfileWire]
  /// Actions whose outcome the service should reconcile through `status`.
  public let unsettled: [String]

  public init(
    hostId: String, hostGeneration: Int, lockHeld: Bool, profiles: [CapabilityProfileWire],
    unsettled: [String]
  ) {
    protocolVersion = ComputerWireLimits.protocolVersion
    self.hostId = hostId
    self.hostGeneration = max(1, hostGeneration)
    self.lockHeld = lockHeld
    self.profiles = Array(profiles.prefix(ComputerWireLimits.maxProfiles))
    self.unsettled = Array(unsettled.prefix(ComputerWireLimits.maxStatusIds))
  }

  private enum CodingKeys: String, CodingKey {
    case protocolVersion = "protocol"
    case hostId, hostGeneration, lockHeld, profiles, unsettled
  }
}

/// The shell → service computer frames, as text for the control stream.
public enum ComputerFrames {
  public static func hello(_ host: ComputerHelloWire) throws -> String {
    try ComputerWireCoding.encode(Frame(type: "computer.hello", host: host))
  }

  public static func reply(_ reply: HostReplyWire) throws -> String {
    try ComputerWireCoding.encode(Frame(type: "computer.reply", reply: reply))
  }

  public static func progress(_ progress: ComputerProgressWire) throws -> String {
    try ComputerWireCoding.encode(Frame(type: "computer.progress", progress: progress))
  }

  private struct Frame: Encodable {
    let type: String
    var host: ComputerHelloWire?
    var reply: HostReplyWire?
    var progress: ComputerProgressWire?
  }
}
