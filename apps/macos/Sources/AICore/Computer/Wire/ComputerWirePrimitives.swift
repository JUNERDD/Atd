import Foundation

/// The closed vocabulary the computer control frames share, mirrored by hand from
/// `packages/agent-contracts/src/computer-actions.ts`, `-targets.ts` and `-results.ts`. Every
/// wire type in this folder decodes as a closed object (``BridgeCoding/keyed(_:_:)``) with the
/// contract's string patterns, lengths and item counts, so a frame the service would not send is
/// refused here as malformed rather than half-understood.
public enum ComputerWireLimits {
  public static let maxSteps = 12
  public static let maxTextLength = 20000
  public static let maxWaitMs = 30000
  public static let maxUrlLength = 2048
  public static let maxRunBindings = 8
  public static let maxElements = 300
  public static let maxEvidence = 20
  public static let maxStatusIds = 100
  public static let maxProfiles = 4
  public static let maxScreenshotBase64 = 11_184_812
  public static let maxErrorMessage = 2000
  /// `COMPUTER_PROTOCOL`: the computer protocol this host speaks (`computer.hello.host.protocol`).
  /// The service binds a host only when it speaks exactly this version. Protocol 8 is
  /// background-only: no run mode, no foreground takeover, refusals and disturbances as facts.
  public static let protocolVersion = 8
  /// `COMPUTER_MAX_SURFACES`: surfaces one observation lists.
  public static let maxSurfaces = 16
  /// `COMPUTER_MAX_TEXT_BOXES`: recognized text boxes one observation carries.
  public static let maxTextBoxes = 200
  /// Capability entries one target ref carries.
  public static let maxTargetCapabilities = 16
  /// Items of a `menu` step's path.
  public static let maxMenuPath = 8
  /// Resources one `upload` step sets on a file input.
  public static let maxUploadFiles = 5
  /// Downloads one action result reports.
  public static let maxDownloads = 5
  /// The largest file an `upload` step may set (50 MB).
  public static let maxUploadBytes = 50 * 1024 * 1024
  /// `COMPUTER_MAX_DISTURBANCES`: disturbances one action result lists.
  public static let maxDisturbances = 8
  /// Routes one target capability lists.
  public static let maxCapabilityRoutes = 6
}

/// The contract's string patterns (JSON Schema `pattern`, unanchored as written).
enum ComputerPattern {
  static let identifier = "^[a-zA-Z0-9_-]+$"
  static let refId = "^[A-Za-z0-9_.:-]+$"
  static let actionId =
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
  static let stepId = "^[a-zA-Z0-9_-]+$"
  static let url = "^https?://"
  static let hash = "^[0-9a-f]{64}$"
  static let origin = "^https?://[^/?#\\s]+$"
}

extension KeyedDecodingContainer {
  /// `Identifier`: 1 to 128 of `[a-zA-Z0-9_-]`.
  func identifier(_ key: Key) throws -> String {
    try string(key, minLength: 1, maxLength: 128, pattern: ComputerPattern.identifier)
  }

  /// `ComputerRefIdSchema`: an opaque host-minted id.
  func refId(_ key: Key) throws -> String {
    try string(key, minLength: 1, maxLength: 256, pattern: ComputerPattern.refId)
  }

  func actionId(_ key: Key) throws -> String {
    try string(key, pattern: ComputerPattern.actionId)
  }

  func operationId(_ key: Key) throws -> String {
    try string(key, minLength: 1, maxLength: 128)
  }

  func computerURL(_ key: Key) throws -> String {
    try string(
      key, minLength: 1, maxLength: ComputerWireLimits.maxUrlLength, pattern: ComputerPattern.url)
  }

  func computerHash(_ key: Key) throws -> String {
    try string(key, pattern: ComputerPattern.hash)
  }
}

/// `ComputerEffectSchema`: what a step does to the world. `invoke` is a UI action whose business
/// effect the host cannot know; it always needs approval and never runs unattended.
public enum ComputerEffect: String, Codable, CaseIterable, Sendable {
  case read
  case navigate
  case input
  case click
  case invoke
  case submit

  /// `COMPUTER_BUSINESS_EFFECTS` (`invoke`, `submit`): never retried automatically.
  public var isBusiness: Bool { self == .invoke || self == .submit }

  /// `COMPUTER_EFFECT_RANK`: how far an effect reaches, for ordering the effects of an action.
  public var rank: Int {
    switch self {
    case .read: 0
    case .navigate: 1
    case .input: 2
    case .click: 3
    case .invoke: 4
    case .submit: 5
    }
  }
}

/// `ComputerStepKindSchema`.
public enum ComputerStepKind: String, Codable, CaseIterable, Sendable {
  case navigate
  case fill
  case press
  case scroll
  case wait
  case setValue
  case click
  case key
  case type
  case clear
  case menu
  case drag
  case select
  case upload
}

/// `ComputerDeliverySchema`: how input reaches a target. `background` is the only delivery, the
/// imperceptible contract: the host never moves the person's pointer, never activates, raises or
/// minimizes a window, hands back any key focus it borrows before that input ends, opens no
/// visible menu, and leaves the Space and the clipboard alone. A step without such a route is
/// refused (``ComputerErrorCode/noBackgroundRoute``), never escalated. It stays a reported fact
/// (results, profiles) so another delivery could be added without reshaping them.
public enum ComputerDelivery: String, Codable, CaseIterable, Sendable {
  case background
}

/// `ComputerEngineSchema`: the engines a host drives: `playwright` for managed browser profiles
/// (playwright-core over CDP), `atd` (the app's own background driver, built in) for native apps.
public enum ComputerEngineID: String, Codable, CaseIterable, Sendable {
  case playwright
  case atd
}

/// `ComputerTargetKindSchema`; each kind has exactly one engine (`COMPUTER_ENGINE_FOR_KIND`).
public enum ComputerTargetKind: String, Codable, CaseIterable, Sendable {
  case browser
  case native

  public var engine: ComputerEngineID {
    switch self {
    case .browser: .playwright
    case .native: .atd
    }
  }
}

/// `ComputerErrorCodeSchema` (closed, D3). Decoding also reads the codes protocol 8 retired
/// (``retired``) as their replacements, so a host journal entry written before it still decodes
/// and `status` answers only current codes; nothing encodes a retired code.
public enum ComputerErrorCode: String, Codable, CaseIterable, Sendable {
  case notQualified
  case targetUnavailable
  case targetChanged
  case staleObservation
  case ambiguous
  case notFound
  /// The step has no imperceptible route on this target; the error's `reason` says which limit.
  case noBackgroundRoute
  case needsPermission
  /// Screen capture was never prepared in Settings; an unattended run never prompts for it.
  case needsConsent
  case locked
  case busy
  /// The person is using the target (frontmost and focused), so the host yields.
  case targetInUse
  case cancelled
  case timeout
  case unsupported
  case engineFailed
  case hostUnavailable
  /// A write to a surface while a modal child of it is open.
  case modalBlocked
  /// The action disturbed the person: the guard attributed a disturbance to the agent.
  case disturbed

  /// `RETIRED_COMPUTER_ERROR_CODES`: the codes protocol 8 retired, with the code each reads as.
  public static let retired: [String: ComputerErrorCode] = [
    "needsForeground": .noBackgroundRoute,
    "userTookOver": .targetInUse,
    "paused": .cancelled,
  ]

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    let raw = try container.decode(String.self)
    guard let code = Self(rawValue: raw) ?? Self.retired[raw] else {
      throw DecodingError.dataCorruptedError(
        in: container, debugDescription: "Unknown computer error code \(raw).")
    }
    self = code
  }
}

/// `ComputerErrorSchema`. The message is cut to the contract's 2000 characters on creation, so an
/// engine's long diagnostic can never make the service refuse the whole reply. `reason` names the
/// background limit behind a refusal, when one did.
public struct ComputerErrorWire: Codable, Equatable, Sendable {
  public let code: ComputerErrorCode
  public let message: String
  public let reason: ComputerRefusalReason?

  public init(code: ComputerErrorCode, message: String, reason: ComputerRefusalReason? = nil) {
    self.code = code
    self.message = message.wireClipped(ComputerWireLimits.maxErrorMessage)
    self.reason = reason
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    code = try container.value(.code, ComputerErrorCode.self)
    message = try container.string(.message, maxLength: ComputerWireLimits.maxErrorMessage)
    reason = try container.optional(.reason) {
      try container.value($0, ComputerRefusalReason.self)
    }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case code
    case message
    case reason
  }
}

/// `ComputerCancelReasonSchema`.
public enum ComputerCancelReason: String, Codable, CaseIterable, Sendable {
  case stopped
  /// The service's run ended normally; the host ends the run's shares and previews, quits
  /// run-scoped managed browser profiles, and releases per-target preparation such as occlusion
  /// keep-alive.
  case finished
  case timedOut
  case revoked
  case shuttingDown
}

/// `ComputerGrantRefSchema`.
public struct ComputerGrantRefWire: Codable, Equatable, Sendable {
  public let grantId: String
  public let version: Int

  public init(grantId: String, version: Int) {
    self.grantId = grantId
    self.version = version
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    grantId = try container.identifier(.grantId)
    version = try container.integer(.version, minimum: 1)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case grantId
    case version
  }
}

/// How the computer frames encode: sorted keys, slashes unescaped, absent optionals omitted
/// (never `null`, which the closed TypeBox objects would refuse).
public enum ComputerWireCoding {
  public static func encode(_ value: some Encodable) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  public static func decode<Value: Decodable>(_ type: Value.Type, from text: String) throws
    -> Value
  {
    try JSONDecoder().decode(type, from: Data(text.utf8))
  }

  /// The contract's timestamps (`toISOString` style), written by the host.
  public static func timestamp(_ date: Date) -> String {
    date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .gmt))
  }
}

extension String {
  /// The first `limit` Unicode scalars. The contracts bound string length in code points (TypeBox
  /// `maxLength`), so cutting by `prefix` (grapheme clusters) could leave a decomposed or emoji-rich
  /// value longer than the service accepts, and it would reject the whole frame.
  public func wireClipped(_ limit: Int) -> String {
    String(String.UnicodeScalarView(unicodeScalars.prefix(limit)))
  }
}
