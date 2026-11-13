import Foundation

/// Metadata from the optional WPS add-in. Titles bind evidence to the foreground document;
/// no cell content or clipboard data is transferred or persisted.
public nonisolated struct WpsSelectionState: Decodable, Sendable {
  public struct Event: Decodable, Sendable {
    public enum Kind: String, Decodable, Sendable { case cells, clear, context }
    public let sequence: Int
    public let occurredAt: Double
    public let kind: Kind
    public let windowTitle: String
    public let hasContent: Bool
  }
  public let installed: Bool
  public let connected: Bool
  public let sampled: Bool
  public let requestId: String?
  public let event: Event?
}
