import Foundation

/// One current read-only image or an explicit absence. Never an actionable capture or target.
public struct ComputerVisualSourceWire: Encodable, Equatable, Sendable {
  public enum Content: Equatable, Sendable {
    case frame(capturedAt: Date, width: Int, height: Int, data: Data)
    case unchanged
    case unavailable(ScreenShareReplyWire.Unavailable)
  }

  public let sourceId: String
  public let label: String
  public let sequence: Int
  public let checkedAt: Date
  public let content: Content

  public init(sourceId: String, label: String, sequence: Int, checkedAt: Date, content: Content) {
    self.sourceId = sourceId
    self.label = label
    self.sequence = sequence
    self.checkedAt = checkedAt
    self.content = content
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encode(sourceId, forKey: .sourceId)
    try container.encode(label, forKey: .label)
    try container.encode(sequence, forKey: .sequence)
    try container.encode(ComputerWireCoding.timestamp(checkedAt), forKey: .checkedAt)
    switch content {
    case .frame(let capturedAt, let width, let height, let data):
      try container.encode("frame", forKey: .state)
      try container.encode(ComputerWireCoding.timestamp(capturedAt), forKey: .capturedAt)
      try container.encode(width, forKey: .width)
      try container.encode(height, forKey: .height)
      try container.encode("image/jpeg", forKey: .mime)
      try container.encode(data.base64EncodedString(), forKey: .base64)
    case .unchanged:
      try container.encode("unchanged", forKey: .state)
    case .unavailable(let reason):
      try container.encode("unavailable", forKey: .state)
      try container.encode(reason, forKey: .reason)
    }
  }

  private enum Keys: String, CodingKey {
    case sourceId, label, sequence, checkedAt, state, capturedAt, width, height, mime, base64,
      reason
  }
}

public struct ScreenContextOperationWire: Decodable, Equatable, Sendable {
  public let targetRefIds: [String]
  public let includeShared: Bool
  public let limit: Int

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, Keys.self)
    try container.literal(.kind, "screenContext")
    targetRefIds = try container.array(
      .targetRefIds, of: String.self, maxItems: 4, uniqueItems: true)
    guard
      targetRefIds.allSatisfy({
        !$0.isEmpty && $0.count <= 256 && BridgeCoding.matches($0, ComputerPattern.refId)
      })
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .targetRefIds, in: container, debugDescription: "Invalid visual target ref.")
    }
    includeShared = try container.boolean(.includeShared)
    limit = try container.integer(.limit, minimum: 1, maximum: 4)
  }
  private enum Keys: String, CodingKey, CaseIterable {
    case kind, targetRefIds, includeShared, limit
  }
}
