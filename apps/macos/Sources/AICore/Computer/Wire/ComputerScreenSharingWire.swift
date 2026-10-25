import Foundation

/// Protocol7's system-selected sources. A new start adds one independent picker selection.
public enum ScreenShareOperationWire: Decodable, Equatable, Sendable {
  case start
  case read(after: [ScreenCursorWire]?, timeoutMs: Int)
  case stop(sourceId: String?)

  public init(from decoder: any Decoder) throws {
    let mode = try decoder.container(keyedBy: ModeKeys.self).decode(String.self, forKey: .mode)
    switch mode {
    case "start":
      let container = try BridgeCoding.keyed(decoder, ModeKeys.self)
      try container.literal(.kind, "screenShare")
      self = .start
    case "stop":
      let container = try BridgeCoding.keyed(decoder, StopKeys.self)
      try container.literal(.kind, "screenShare")
      self = .stop(sourceId: try container.optional(.sourceId) { try container.identifier($0) })
    case "read":
      let container = try BridgeCoding.keyed(decoder, ReadKeys.self)
      try container.literal(.kind, "screenShare")
      self = .read(
        after: try container.optional(.after) {
          try container.array($0, of: ScreenCursorWire.self, maxItems: 4)
        }, timeoutMs: try container.integer(.timeoutMs, minimum: 0, maximum: 30000))
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown screen sharing mode."))
    }
  }

  private enum ModeKeys: String, CodingKey, CaseIterable { case kind, mode }
  private enum StopKeys: String, CodingKey, CaseIterable { case kind, mode, sourceId }
  private enum ReadKeys: String, CodingKey, CaseIterable { case kind, mode, after, timeoutMs }
}

public struct ScreenCursorWire: Codable, Equatable, Sendable {
  public let sourceId: String
  public let sequence: Int

  public init(sourceId: String, sequence: Int) {
    self.sourceId = sourceId
    self.sequence = sequence
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, Keys.self)
    sourceId = try container.identifier(.sourceId)
    sequence = try container.integer(.sequence, minimum: 0)
  }
  private enum Keys: String, CodingKey, CaseIterable { case sourceId, sequence }
}

public enum ScreenShareReplyWire: Encodable, Equatable, Sendable {
  public enum Unavailable: String, Encodable, Sendable {
    case starting, blank, suspended, captureFailed, locked, targetUnavailable, permission,
      disconnected
  }
  public enum Ended: String, Encodable, Sendable {
    case notStarted, cancelled, stopped, finished, disconnected, captureFailed
  }

  case sharing([ComputerVisualSourceWire])
  case ended(Ended)

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encode("screenShare", forKey: .kind)
    switch self {
    case .sharing(let sources):
      try container.encode("sharing", forKey: .state)
      try container.encode(sources, forKey: .sources)
    case .ended(let reason):
      try container.encode("ended", forKey: .state)
      try container.encode(reason, forKey: .reason)
    }
  }
  private enum Keys: String, CodingKey { case kind, state, sources, reason }
}
