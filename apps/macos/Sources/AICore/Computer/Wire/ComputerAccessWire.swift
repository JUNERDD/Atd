import Foundation

/// An attended access request names an app or URL; the host resolves its actual identity.
public enum ComputerAccessTargetWire: Decodable, Equatable, Sendable {
  case application(String)
  case website(String)

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
    switch kind {
    case "application":
      let container = try BridgeCoding.keyed(decoder, ApplicationKeys.self)
      self = .application(try container.string(.application, minLength: 1, maxLength: 255))
    case "website":
      let container = try BridgeCoding.keyed(decoder, WebsiteKeys.self)
      self = .website(try container.computerURL(.url))
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown access target."))
    }
  }

  private enum Keys: String, CodingKey { case kind }
  private enum ApplicationKeys: String, CodingKey, CaseIterable { case kind, application }
  private enum WebsiteKeys: String, CodingKey, CaseIterable { case kind, url }
}

/// Only the authenticated service sends this operation, after its target-specific approval gate.
/// The host opens the target without bringing anything forward; `persistent` keeps the browser
/// profile the binding names after the run.
public struct OpenComputerAccessWire: Decodable, Equatable, Sendable {
  public let binding: TargetBindingWire
  public let persistent: Bool

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, Keys.self)
    binding = try container.value(.binding, TargetBindingWire.self)
    persistent = try container.boolean(.persistent)
  }

  private enum Keys: String, CodingKey, CaseIterable { case kind, binding, persistent }
}
