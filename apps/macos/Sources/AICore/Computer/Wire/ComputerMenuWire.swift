import Foundation

/// Read-only application menu state. Paths are exact menu titles, not window element refs.
public struct ComputerMenuItemWire: Codable, Equatable, Sendable {
  public let path: [String]
  public let enabled: Bool

  public init(path: [String], enabled: Bool) {
    self.path = path
    self.enabled = enabled
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    path = try Self.path(container, key: .path)
    enabled = try container.boolean(.enabled)
  }

  static func path<Key: CodingKey>(
    _ container: KeyedDecodingContainer<Key>, key: Key
  ) throws -> [String] {
    let path = try container.array(
      key, of: String.self, minItems: 2, maxItems: ComputerWireLimits.maxMenuPath)
    guard path.allSatisfy({ !$0.isEmpty && $0.utf16.count <= 200 }) else {
      throw DecodingError.dataCorruptedError(
        forKey: key, in: container, debugDescription: "Menu titles must have 1–200 characters.")
    }
    return path
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case path, enabled }
}
