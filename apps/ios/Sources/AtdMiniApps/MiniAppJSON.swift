import Foundation

/// A JSON value as mini apps store and exchange it: field values and records in the data file,
/// the model's data and widget sections, and the messages a page sends through the bridge. Plain
/// JSON on disk, so a field's value reads as its own kind (`8`, `"帐篷"`, `{"2026-11-21": 5}`); the
/// schema says how to read it (`MiniAppSchema`).
public enum MiniAppJSON: Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([MiniAppJSON])
  case object([String: MiniAppJSON])

  public var number: Double? {
    if case .number(let value) = self { value } else { nil }
  }

  public var string: String? {
    if case .string(let value) = self { value } else { nil }
  }

  public var bool: Bool? {
    if case .bool(let value) = self { value } else { nil }
  }

  public var array: [MiniAppJSON]? {
    if case .array(let value) = self { value } else { nil }
  }

  public var object: [String: MiniAppJSON]? {
    if case .object(let value) = self { value } else { nil }
  }

  public subscript(key: String) -> MiniAppJSON? {
    object?[key]
  }

  /// Parses one JSON document; nil when `text` is not JSON.
  public static func parse(_ text: String) -> MiniAppJSON? {
    parse(Data(text.utf8))
  }

  public static func parse(_ data: Data) -> MiniAppJSON? {
    try? JSONDecoder().decode(MiniAppJSON.self, from: data)
  }

  /// Compact JSON with sorted keys; numbers that are whole print without a fraction.
  public var jsonData: Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    // Every value Atd stores was checked to be finite, so encoding cannot fail.
    return (try? encoder.encode(self)) ?? Data("null".utf8)
  }

  public var jsonString: String {
    String(decoding: jsonData, as: UTF8.self)
  }
}

extension MiniAppJSON: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([MiniAppJSON].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: MiniAppJSON].self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}

extension MiniAppJSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
  ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral,
  ExpressibleByDictionaryLiteral
{
  public init(stringLiteral value: String) {
    self = .string(value)
  }

  public init(integerLiteral value: Int) {
    self = .number(Double(value))
  }

  public init(floatLiteral value: Double) {
    self = .number(value)
  }

  public init(booleanLiteral value: Bool) {
    self = .bool(value)
  }

  public init(arrayLiteral elements: MiniAppJSON...) {
    self = .array(elements)
  }

  public init(dictionaryLiteral elements: (String, MiniAppJSON)...) {
    self = .object(Dictionary(elements) { _, last in last })
  }
}
