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

  /// Extracts the top-level `"t"` string member from a JSON object frame without decoding the full
  /// payload, so oversized `diag.batch` frames can be dropped before `JSONDecoder` runs.
  public static func peekFrameType(in data: Data) -> String? {
    data.withUnsafeBytes { raw -> String? in
      guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return nil }
      let count = raw.count
      var i = 0
      func skipWS() {
        while i < count {
          let b = base[i]
          if b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D { i += 1 } else { break }
        }
      }
      func readString(maxUnescapedBytes: Int) -> (ok: Bool, value: String?) {
        guard i < count, base[i] == 0x22 else { return (false, nil) }
        i += 1
        let start = i
        var hasEscape = false
        while i < count {
          let b = base[i]
          if b == 0x5C {
            hasEscape = true
            i += 2
            continue
          }
          if b == 0x22 {
            let end = i
            i += 1
            guard !hasEscape, end - start <= maxUnescapedBytes else { return (true, nil) }
            let slice = UnsafeBufferPointer(start: base.advanced(by: start), count: end - start)
            return (true, String(decoding: slice, as: UTF8.self))
          }
          i += 1
        }
        return (false, nil)
      }
      func skipValue() -> Bool {
        skipWS()
        guard i < count else { return false }
        let b = base[i]
        if b == 0x22 { return readString(maxUnescapedBytes: 0).ok }
        if b == 0x7B || b == 0x5B {
          var depth = 0
          while i < count {
            let c = base[i]
            if c == 0x22 {
              guard readString(maxUnescapedBytes: 0).ok else { return false }
              continue
            }
            if c == 0x7B || c == 0x5B {
              depth += 1
            } else if c == 0x7D || c == 0x5D {
              depth -= 1
              if depth == 0 {
                i += 1
                return true
              }
            }
            i += 1
          }
          return false
        }
        while i < count {
          let c = base[i]
          if c == 0x2C || c == 0x7D || c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D {
            return true
          }
          i += 1
        }
        return false
      }

      skipWS()
      guard i < count, base[i] == 0x7B else { return nil }
      i += 1
      while true {
        skipWS()
        guard i < count else { return nil }
        if base[i] == 0x7D { return nil }
        let key = readString(maxUnescapedBytes: 64)
        guard key.ok else { return nil }
        skipWS()
        guard i < count, base[i] == 0x3A else { return nil }
        i += 1
        skipWS()
        if key.value == "t" {
          let val = readString(maxUnescapedBytes: 64)
          return val.ok ? val.value : nil
        }
        guard skipValue() else { return nil }
        skipWS()
        guard i < count else { return nil }
        if base[i] == 0x2C {
          i += 1
        } else if base[i] == 0x7D {
          return nil
        } else {
          return nil
        }
      }
    }
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

  /// An optional ``whole(_:minimum:maximum:)``; an absent member is nil, `null` is refused.
  public func optionalWhole(
    _ key: Key, minimum: Int = .min, maximum: Int = .max
  ) throws -> Int? {
    contains(key) ? try whole(key, minimum: minimum, maximum: maximum) : nil
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

  /// An array of `minCount`…`maxCount` items, each decoded with its own checks.
  public func array<Item: Decodable>(
    _ key: Key, of item: Item.Type, minCount: Int = 0, maxCount: Int
  ) throws -> [Item] {
    let values = try decode([Item].self, forKey: key)
    guard values.count >= minCount, values.count <= maxCount else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: self,
        debugDescription: "\(key.stringValue) must have \(minCount) to \(maxCount) items.")
    }
    return values
  }

  /// An optional array of `minCount`…`maxCount` items, each decoded with its own checks; an absent
  /// member is nil, `null` is refused.
  public func optionalArray<Item: Decodable>(
    _ key: Key, of item: Item.Type, minCount: Int = 0, maxCount: Int
  ) throws -> [Item]? {
    guard contains(key) else { return nil }
    return try array(key, of: item, minCount: minCount, maxCount: maxCount)
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
