import Foundation

/// `SaveComputerBindingRequestSchema` (`POST /v1/computer/bindings`, shell only): the content of a
/// target the host prepared, registered as a new binding, or as binding `bindingId` when set (the
/// service answers 409 when `expectedRevision` moved on). The service assigns revision and hash.
public struct SaveComputerBindingRequestWire: Encodable, Equatable, Sendable {
  /// `TargetBindingContentSchema`: a binding without its id, revision and hash.
  public enum Content: Equatable, Sendable {
    /// A browser target; `urlPrefix` is the page rule's prefix. Without `channel`, `profileId` is
    /// a managed browser profile; on the `chrome` channel, the paired Atd for Chrome's
    /// installation id.
    case browser(
      label: String, profileId: String, allowedOrigins: [String], startUrl: String,
      urlPrefix: String, channel: ComputerBrowserChannel? = nil)
    /// The app `bundleId`, at the `.app` path the host verified, with the code-signing team it
    /// read when there is one.
    case native(
      label: String, bundleId: String, appName: String, appPath: String, teamId: String?)
  }

  public let bindingId: String?
  public let expectedRevision: Int?
  public let content: Content

  public init(content: Content, bindingId: String? = nil, expectedRevision: Int? = nil) {
    self.content = content
    self.bindingId = bindingId
    self.expectedRevision = expectedRevision
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(bindingId, forKey: .bindingId)
    try container.encodeIfPresent(expectedRevision, forKey: .expectedRevision)
    try container.encode(content, forKey: .content)
  }

  private enum CodingKeys: String, CodingKey { case bindingId, expectedRevision, content }
}

extension SaveComputerBindingRequestWire.Content: Encodable {
  /// `computerEngineFor`: the engine the saved binding will run on.
  public var engine: ComputerEngineID {
    switch self {
    case .browser(_, _, _, _, _, let channel):
      channel == .chrome ? .chrome : ComputerTargetKind.browser.engine
    case .native: ComputerTargetKind.native.engine
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .browser(
      let label, let profileId, let allowedOrigins, let startUrl, let urlPrefix, let channel):
      try container.encode(ComputerTargetKind.browser, forKey: .kind)
      try container.encodeIfPresent(channel, forKey: .channel)
      try container.encode(label, forKey: .label)
      try container.encode(profileId, forKey: .profileId)
      try container.encode(allowedOrigins, forKey: .allowedOrigins)
      try container.encode(startUrl, forKey: .startUrl)
      try container.encode(["urlPrefix": urlPrefix], forKey: .pageRule)
    case .native(let label, let bundleId, let appName, let appPath, let teamId):
      try container.encode(ComputerTargetKind.native, forKey: .kind)
      try container.encode(label, forKey: .label)
      try container.encode(bundleId, forKey: .bundleId)
      try container.encode(appName, forKey: .appName)
      try container.encode(appPath, forKey: .appPath)
      try container.encodeIfPresent(teamId, forKey: .teamId)
    }
  }

  private enum CodingKeys: String, CodingKey {
    case kind, channel, label, profileId, allowedOrigins, startUrl, pageRule, bundleId, appName
    case appPath, teamId
  }
}
