import Foundation

/// The checks every channel frame runs while decoding: string lengths in Unicode code points,
/// integer ranges and array lengths. A member the contract does not declare is ignored, so an
/// extension newer than this shell can add optional members (`protocol.ts` makes the same promise
/// for shell frames). The kit is shared by the native host and AICore, so it carries these few
/// rules itself instead of AICore's `BridgeCoding`.
public enum ChromeChannelCoding {
  /// The object's members `Keys` names; any other member is ignored.
  public static func object<Keys: CodingKey>(_ decoder: any Decoder, _ keys: Keys.Type) throws
    -> KeyedDecodingContainer<Keys>
  {
    try decoder.container(keyedBy: Keys.self)
  }

  /// How every frame encodes: sorted keys, slashes unescaped, absent optionals omitted.
  public static func encode(_ value: some Encodable) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
  }
}

extension KeyedDecodingContainer {
  /// A string of `minLength`…`maxLength` code points. TypeBox counts UTF-16 code units, never
  /// fewer than code points, so every string the extension's schema admits passes.
  public func text(_ key: Key, minLength: Int = 0, maxLength: Int) throws -> String {
    let value = try decode(String.self, forKey: key)
    let length = value.unicodeScalars.count
    guard length >= minLength, length <= maxLength else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self,
        debugDescription: "\(key.stringValue) must have \(minLength) to \(maxLength) characters.")
    }
    return value
  }

  /// An optional ``text(_:minLength:maxLength:)``; an absent member is nil, `null` is refused.
  public func optionalText(_ key: Key, minLength: Int = 0, maxLength: Int) throws -> String? {
    contains(key) ? try text(key, minLength: minLength, maxLength: maxLength) : nil
  }

  /// An `IdSchema` of the channel: 1 to 256 code units, the ids the extension and the service mint
  /// (request, task and run ids).
  public func id(_ key: Key) throws -> String {
    try text(key, minLength: 1, maxLength: ChromeChannelProtocol.maxIdLength)
  }

  /// A `TargetIdSchema`: a tab's CDP target id, 1 to 128 code units.
  public func targetId(_ key: Key) throws -> String {
    try text(key, minLength: 1, maxLength: ChromeChannelProtocol.maxTargetIdLength)
  }

  /// An `Identifier` of the service contracts: 1 to 128 of `[a-zA-Z0-9_-]`.
  public func identifier(_ key: Key) throws -> String {
    let value = try text(key, minLength: 1, maxLength: ChromeChannelProtocol.maxIdentifierLength)
    guard
      value.utf8.allSatisfy({
        (0x30...0x39).contains($0) || (0x41...0x5a).contains($0) || (0x61...0x7a).contains($0)
          || $0 == 0x5f || $0 == 0x2d
      })
    else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self, debugDescription: "\(key.stringValue) must be an identifier.")
    }
    return value
  }

  /// An integer within `minimum`…`maximum`.
  public func whole(_ key: Key, minimum: Int = .min, maximum: Int = .max) throws -> Int {
    let value = try decode(Int.self, forKey: key)
    guard value >= minimum, value <= maximum else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self,
        debugDescription: "\(key.stringValue) must be \(minimum) to \(maximum).")
    }
    return value
  }

  /// An optional finite number `>= 0`; an absent member is nil, `null` is refused.
  public func optionalNonNegativeFinite(_ key: Key) throws -> Double? {
    guard contains(key) else { return nil }
    let value = try decode(Double.self, forKey: key)
    guard value.isFinite, value >= 0 else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self, debugDescription: "\(key.stringValue) must be non-negative.")
    }
    return value
  }

  /// An optional array of `minCount`…`maxCount` items, each decoded with its own checks; an absent
  /// member is nil, `null` is refused.
  public func optionalArray<Item: Decodable>(
    _ key: Key, of item: Item.Type, minCount: Int = 0, maxCount: Int
  ) throws -> [Item]? {
    guard contains(key) else { return nil }
    let values = try decode([Item].self, forKey: key)
    guard values.count >= minCount, values.count <= maxCount else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self,
        debugDescription: "\(key.stringValue) must have \(minCount) to \(maxCount) items.")
    }
    return values
  }

  /// The protocol version member every frame carries.
  public func version(_ key: Key) throws {
    guard try decode(Int.self, forKey: key) == ChromeChannelProtocol.version else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self,
        debugDescription: "Unsupported channel version; expected \(ChromeChannelProtocol.version).")
    }
  }
}

/// The channel's protocol identity (`CHROME_CHANNEL_PROTOCOL`) and the limits of `payloads.ts`.
public enum ChromeChannelProtocol {
  public static let version = 1
  /// `IdSchema`: request, task and run ids.
  public static let maxIdLength = 256
  /// The service's `Identifier`, which an installation id becomes (a binding's `profileId`).
  public static let maxIdentifierLength = 128
  /// `TargetIdSchema`: a tab's CDP target id.
  public static let maxTargetIdLength = 128
  /// `OriginSchema`.
  public static let maxOriginLength = 2048
  /// `TextSchema`: URLs, titles, typed questions, result text and messages.
  public static let maxTextLength = 100_000
}

extension String {
  /// The string cut to at most `limit` UTF-16 code units (the unit TypeBox's `maxLength` counts)
  /// at a character boundary, so a frame the shell builds always passes the extension's schema.
  public func clipped(toUTF16 limit: Int) -> String {
    guard utf16.count > limit else { return self }
    var count = 0
    var end = startIndex
    for index in indices {
      let next = count + self[index].utf16.count
      guard next <= limit else { break }
      count = next
      end = self.index(after: index)
    }
    return String(self[..<end])
  }
}
