import Foundation

/// `ComputerAccessBrowserSchema`: which browser opens a website: `chrome`, the person's own Chrome
/// through Atd for Chrome (a binding on the `chrome` channel), or `managed`, a browser profile the
/// host manages.
public enum ComputerAccessBrowser: String, Codable, CaseIterable, Sendable {
  case chrome
  case managed
}

/// `PreparedComputerAccessTargetSchema`: an attended access request names an app or URL; the host
/// resolves its actual identity. A website always names the browser the service resolved for it
/// (the call's own, else the run's default), and the candidate must be on that browser.
public enum ComputerAccessTargetWire: Decodable, Equatable, Sendable {
  case application(String)
  case website(url: String, browser: ComputerAccessBrowser)

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
    switch kind {
    case "application":
      let container = try BridgeCoding.keyed(decoder, ApplicationKeys.self)
      self = .application(try container.string(.application, minLength: 1, maxLength: 255))
    case "website":
      let container = try BridgeCoding.keyed(decoder, WebsiteKeys.self)
      self = .website(
        url: try container.computerURL(.url),
        browser: try container.value(.browser, ComputerAccessBrowser.self))
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown access target."))
    }
  }

  private enum Keys: String, CodingKey { case kind }
  private enum ApplicationKeys: String, CodingKey, CaseIterable { case kind, application }
  private enum WebsiteKeys: String, CodingKey, CaseIterable { case kind, url, browser }
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
