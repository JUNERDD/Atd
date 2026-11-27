import Foundation

/// Execution surface inside Atd for Chrome that produced a diagnostic log entry (`diag.batch`),
/// mirrored by hand from `apps/chrome-extension/src/channel/diagnostics.ts`.
public enum ChromeDiagSurface: String, Codable, Equatable, Sendable {
  case background
  case content
  case panel
  case options
}

/// Severity of an extension diagnostic log entry (`diag.batch`).
public enum ChromeDiagLevel: String, Codable, Equatable, Sendable {
  case info
  case warn
  case error
}

/// One pre-sanitized diagnostic entry sent by a paired Atd for Chrome extension (`diag.batch`).
///
/// Field names match `DiagEntrySchema` in `apps/chrome-extension/src/channel/diagnostics.ts`
/// byte-for-byte; `cdpSession` intentionally avoids `sessionId`/`session_id` so the bundle
/// scrubber preserves CDP correlation ids.
public struct ChromeDiagEntry: Decodable, Equatable, Sendable {
  public let seq: Int
  public let extTs: String
  public let surface: ChromeDiagSurface
  public let level: ChromeDiagLevel
  public let cat: String
  public let msg: String
  public let code: String?
  public let runId: String?
  public let tabId: Int?
  public let targetId: String?
  public let cdpSession: String?
  public let origin: String?

  public init(
    seq: Int,
    extTs: String,
    surface: ChromeDiagSurface,
    level: ChromeDiagLevel,
    cat: String,
    msg: String,
    code: String? = nil,
    runId: String? = nil,
    tabId: Int? = nil,
    targetId: String? = nil,
    cdpSession: String? = nil,
    origin: String? = nil
  ) {
    self.seq = seq
    self.extTs = extTs
    self.surface = surface
    self.level = level
    self.cat = cat
    self.msg = msg
    self.code = code
    self.runId = runId
    self.tabId = tabId
    self.targetId = targetId
    self.cdpSession = cdpSession
    self.origin = origin
  }

  public init(from decoder: any Decoder) throws {
    let container = try ChromeChannelCoding.object(decoder, Keys.self)
    seq = try container.whole(.seq, minimum: 1, maximum: 2_147_483_647)
    extTs = try container.text(.extTs, minLength: 1, maxLength: 64)
    surface = try container.decode(ChromeDiagSurface.self, forKey: .surface)
    level = try container.decode(ChromeDiagLevel.self, forKey: .level)
    cat = try container.text(.cat, minLength: 1, maxLength: 64)
    msg = try container.text(.msg, minLength: 1, maxLength: 256)
    code = try container.optionalText(.code, minLength: 1, maxLength: 64)
    runId = container.contains(.runId) ? try container.id(.runId) : nil
    tabId = try container.optionalWhole(.tabId, minimum: 0)
    targetId = try container.optionalText(
      .targetId, minLength: 1, maxLength: ChromeChannelProtocol.maxTargetIdLength)
    cdpSession = try container.optionalText(.cdpSession, minLength: 1, maxLength: 128)
    origin = try container.optionalText(.origin, minLength: 1, maxLength: 256)
  }

  private enum Keys: String, CodingKey {
    case seq, extTs, surface, level, cat, msg, code, runId, tabId, targetId, cdpSession, origin
  }
}

/// `diag.batch`: a bounded batch of extension diagnostic records sent over K2 while paired.
public struct ChromeDiagBatch: Equatable, Sendable {
  /// Maximum raw JSON byte size admitted for a `diag.batch` frame before dropping on receipt.
  public static let maxFrameBytes = 32_768
  public static let maxEntries = 32
  public static let maxDropped = 1_000_000

  public let dropped: Int?
  public let entries: [ChromeDiagEntry]

  public init(dropped: Int? = nil, entries: [ChromeDiagEntry]) {
    self.dropped = dropped
    self.entries = entries
  }

  init(_ container: KeyedDecodingContainer<ChromeInboundKeys.DiagBatch>) throws {
    dropped = try container.optionalWhole(.dropped, minimum: 0, maximum: Self.maxDropped)
    entries = try container.array(
      .entries, of: ChromeDiagEntry.self, minCount: 1, maxCount: Self.maxEntries)
  }
}
