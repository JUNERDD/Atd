import Foundation

/// An arbitrary JSON value: capability inputs and results are `unknown` in the contracts and
/// are typed by each capability's handler.
public enum JSONValue: Codable, Equatable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

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
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
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

extension JSONValue {
  /// A value WebKit handed over (property-list types from `postMessage`); nil when it is not
  /// JSON (a Date, for example).
  public init?(foundation value: Any) {
    guard JSONSerialization.isValidJSONObject([value]),
      let data = try? JSONSerialization.data(withJSONObject: [value]),
      let array = try? JSONDecoder().decode([JSONValue].self, from: data),
      let first = array.first
    else { return nil }
    self = first
  }

  /// The value as WebKit takes it for `callAsyncJavaScript` arguments (Foundation objects,
  /// `NSNull` for null).
  public var foundationObject: Any {
    switch self {
    case .null: NSNull()
    case .bool(let value): value
    case .number(let value): value
    case .string(let value): value
    case .array(let values): values.map(\.foundationObject)
    case .object(let members): members.mapValues(\.foundationObject)
    }
  }

  /// An `Encodable` value as JSON.
  public init(encoding value: some Encodable) throws {
    self = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
  }
}
