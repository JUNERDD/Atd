import Foundation

/// The checks the generated bridge types (`Generated/`) run while decoding what the page posts.
/// They mirror the TypeBox contract (`apps/desktop/src/native-bridge/contract.ts`): closed
/// objects, string lengths in Unicode code points, patterns, numeric ranges, item counts and
/// literal members. A failed check throws a `DecodingError` naming the member.
public enum BridgeCoding {
  /// A key for any member name, to see members a closed object does not declare.
  public struct AnyKey: CodingKey {
    public let stringValue: String
    public var intValue: Int? { nil }

    public init(stringValue: String) { self.stringValue = stringValue }
    public init?(intValue: Int) { nil }
  }

  /// The keys of an object without members.
  public struct NoKeys: CodingKey, CaseIterable {
    public static var allCases: [NoKeys] { [] }
    public var stringValue: String { "" }
    public var intValue: Int? { nil }

    public init?(stringValue: String) { nil }
    public init?(intValue: Int) { nil }
  }

  /// The object's container, after refusing members outside `Keys` (`additionalProperties:
  /// false`).
  public static func keyed<Keys: CodingKey & CaseIterable>(
    _ decoder: any Decoder, _ keys: Keys.Type
  ) throws -> KeyedDecodingContainer<Keys> {
    let members = try decoder.container(keyedBy: AnyKey.self)
    let allowed = Set(Keys.allCases.map(\.stringValue))
    if let extra = members.allKeys.first(where: { !allowed.contains($0.stringValue) }) {
      throw DecodingError.dataCorruptedError(
        forKey: extra, in: members, debugDescription: "Unexpected member \(extra.stringValue).")
    }
    return try decoder.container(keyedBy: Keys.self)
  }

  /// JSON Schema `format: date-time` as JavaScript's `toISOString` writes it (fractional seconds
  /// optional, `Z` or an offset); nil for anything else.
  public static func parseDateTime(_ value: String) -> Date? {
    (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
      ?? (try? Date.ISO8601FormatStyle().parse(value))
  }

  /// JSON Schema `pattern`: an unanchored ECMA-262 regular expression (the contract's are ASCII).
  static func matches(_ value: String, _ pattern: String) -> Bool {
    guard let expression = try? NSRegularExpression(pattern: pattern) else { return false }
    let range = NSRange(value.startIndex..., in: value)
    return expression.firstMatch(in: value, range: range) != nil
  }
}

extension KeyedDecodingContainer {
  /// A string of `minLength`…`maxLength` code points matching `pattern` (unanchored, like
  /// JSON Schema).
  public func string(
    _ key: Key, minLength: Int = 0, maxLength: Int = .max, pattern: String? = nil
  ) throws -> String {
    let value = try decode(String.self, forKey: key)
    let length = value.unicodeScalars.count
    guard length >= minLength, length <= maxLength else {
      throw invalid(key, "must have \(minLength) to \(maxLength) characters")
    }
    if let pattern, !BridgeCoding.matches(value, pattern) {
      throw invalid(key, "must match \(pattern)")
    }
    return value
  }

  public func integer(_ key: Key, minimum: Int = .min, maximum: Int = .max) throws -> Int {
    let value = try decode(Int.self, forKey: key)
    guard value >= minimum, value <= maximum else {
      throw invalid(key, "must be \(minimum) to \(maximum)")
    }
    return value
  }

  public func number(
    _ key: Key, minimum: Double = -.infinity, maximum: Double = .infinity
  ) throws -> Double {
    let value = try decode(Double.self, forKey: key)
    guard value >= minimum, value <= maximum else {
      throw invalid(key, "must be \(minimum) to \(maximum)")
    }
    return value
  }

  public func boolean(_ key: Key) throws -> Bool {
    try decode(Bool.self, forKey: key)
  }

  public func array<Element: Decodable>(
    _ key: Key, of element: Element.Type, minItems: Int = 0, maxItems: Int = .max
  ) throws -> [Element] {
    let value = try decode([Element].self, forKey: key)
    guard value.count >= minItems, value.count <= maxItems else {
      throw invalid(key, "must have \(minItems) to \(maxItems) items")
    }
    return value
  }

  /// An array whose items must differ from each other (`uniqueItems`).
  public func array<Element: Decodable & Hashable>(
    _ key: Key, of element: Element.Type, minItems: Int = 0, maxItems: Int = .max,
    uniqueItems: Bool
  ) throws -> [Element] {
    let value = try array(key, of: element, minItems: minItems, maxItems: maxItems)
    if uniqueItems, Set(value).count != value.count { throw invalid(key, "must not repeat items") }
    return value
  }

  /// A `Type.Record` whose keys match `keyPattern`.
  public func dictionary<Value: Decodable>(
    _ key: Key, of value: Value.Type, keyPattern: String
  ) throws -> [String: Value] {
    let entries = try decode([String: Value].self, forKey: key)
    if let bad = entries.keys.first(where: { !BridgeCoding.matches($0, keyPattern) }) {
      throw invalid(key, "has the key \(bad), which must match \(keyPattern)")
    }
    return entries
  }

  /// A `format: date-time` string, kept as written; ``BridgeCoding/parseDateTime(_:)`` reads it.
  public func dateTime(_ key: Key, maxLength: Int = .max) throws -> String {
    let value = try string(key, maxLength: maxLength)
    guard BridgeCoding.parseDateTime(value) != nil else {
      throw invalid(key, "must be an ISO 8601 date-time")
    }
    return value
  }

  /// A member of a generated type, which checks itself.
  public func value<Value: Decodable>(_ key: Key, _ type: Value.Type) throws -> Value {
    try decode(type, forKey: key)
  }

  /// A literal member (`Type.Literal`), which the generated types do not store.
  public func literal(_ key: Key, _ expected: String) throws {
    guard try decode(String.self, forKey: key) == expected else {
      throw invalid(key, "must be \(expected)")
    }
  }

  public func literal(_ key: Key, _ expected: Bool) throws {
    guard try decode(Bool.self, forKey: key) == expected else {
      throw invalid(key, "must be \(expected)")
    }
  }

  /// A required member that may be null (`Type.Union([T, Type.Null()])`).
  public func nullable<Value>(_ key: Key, _ read: (Key) throws -> Value) throws -> Value? {
    guard contains(key) else {
      throw DecodingError.keyNotFound(
        key, .init(codingPath: codingPath, debugDescription: "\(key.stringValue) is required."))
    }
    return try decodeNil(forKey: key) ? nil : read(key)
  }

  /// A member that may be absent (`Type.Optional`); when present it must not be null.
  public func optional<Value>(_ key: Key, _ read: (Key) throws -> Value) throws -> Value? {
    contains(key) ? try read(key) : nil
  }

  private func invalid(_ key: Key, _ rule: String) -> DecodingError {
    .dataCorruptedError(forKey: key, in: self, debugDescription: "\(key.stringValue) \(rule).")
  }
}
