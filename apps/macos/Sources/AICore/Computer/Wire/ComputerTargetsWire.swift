import Foundation

/// `TargetBindingSchema`: a target a person registered, owned by the service. The host only
/// resolves it to a ``TargetRefWire`` for its own generation; it never stores one as
/// authorization.
public enum TargetBindingWire: Decodable, Equatable, Sendable {
  case browser(Browser)
  case native(Native)

  public struct Browser: Equatable, Sendable {
    public let bindingId: String
    public let revision: Int
    public let hash: String
    public let label: String
    /// The host-managed browser profile; never the person's own profile.
    public let profileId: String
    public let allowedOrigins: [String]
    public let startUrl: String
    /// The first page of the profile whose URL starts with this prefix is the target.
    public let urlPrefix: String
  }

  /// A native binding: an application, whose own windows the run acts on.
  public struct Native: Equatable, Sendable {
    public let bindingId: String
    public let revision: Int
    public let hash: String
    public let label: String
    public let bundleId: String
    public let appName: String
    /// The absolute `.app` path the host verified when the person chose the app.
    public let appPath: String
    /// The code-signing team the host read from the app.
    public let teamId: String?
  }

  public var bindingId: String {
    switch self {
    case .browser(let binding): binding.bindingId
    case .native(let binding): binding.bindingId
    }
  }

  public var revision: Int {
    switch self {
    case .browser(let binding): binding.revision
    case .native(let binding): binding.revision
    }
  }

  public var label: String {
    switch self {
    case .browser(let binding): binding.label
    case .native(let binding): binding.label
    }
  }

  public var kind: ComputerTargetKind {
    switch self {
    case .browser: .browser
    case .native: .native
    }
  }

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Discriminator.self)
      .decode(ComputerTargetKind.self, forKey: .kind)
    switch kind {
    case .browser:
      let container = try BridgeCoding.keyed(decoder, BrowserKeys.self)
      let rule = try container.value(.pageRule, PageRule.self)
      self = .browser(
        Browser(
          bindingId: try container.identifier(.bindingId),
          revision: try container.integer(.revision, minimum: 1),
          hash: try container.computerHash(.hash),
          label: try container.string(.label, minLength: 1, maxLength: 120),
          profileId: try container.identifier(.profileId),
          allowedOrigins: try Self.origins(container),
          startUrl: try container.computerURL(.startUrl),
          urlPrefix: rule.urlPrefix))
    case .native:
      self = .native(try Self.native(decoder))
    }
  }

  /// The application binding, a closed object.
  private static func native(_ decoder: any Decoder) throws -> Native {
    let container = try BridgeCoding.keyed(decoder, NativeKeys.self)
    return Native(
      bindingId: try container.identifier(.bindingId),
      revision: try container.integer(.revision, minimum: 1),
      hash: try container.computerHash(.hash),
      label: try container.string(.label, minLength: 1, maxLength: 120),
      bundleId: try container.string(.bundleId, minLength: 1, maxLength: 255),
      appName: try container.string(.appName, minLength: 1, maxLength: 255),
      appPath: try container.string(.appPath, minLength: 2, maxLength: 4096, pattern: "^/"),
      teamId: try container.optional(.teamId) {
        try container.string($0, minLength: 1, maxLength: 32)
      })
  }

  private static func origins(_ container: KeyedDecodingContainer<BrowserKeys>) throws
    -> [String]
  {
    let origins = try container.array(
      .allowedOrigins, of: String.self, minItems: 1, maxItems: 20, uniqueItems: true)
    for origin in origins
    where origin.isEmpty || origin.count > 512
      || !BridgeCoding.matches(origin, ComputerPattern.origin)
    {
      throw DecodingError.dataCorruptedError(
        forKey: .allowedOrigins, in: container, debugDescription: "allowedOrigins has \(origin).")
    }
    return origins
  }

  /// `pageRule`, itself a closed object.
  private struct PageRule: Decodable {
    let urlPrefix: String

    init(from decoder: any Decoder) throws {
      urlPrefix = try BridgeCoding.keyed(decoder, CodingKeys.self).computerURL(.urlPrefix)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case urlPrefix }
  }

  private enum Discriminator: String, CodingKey { case kind }
  private enum BrowserKeys: String, CodingKey, CaseIterable {
    case bindingId, revision, hash, kind, label, profileId, allowedOrigins, startUrl, pageRule
  }
  private enum NativeKeys: String, CodingKey, CaseIterable {
    case bindingId, revision, hash, kind, label, bundleId, appName, appPath, teamId
  }
}

/// `TargetRefSchema`: a binding resolved by one host generation and one engine generation. The
/// model only passes `id` back; any restart of the host or the engine makes older refs stale.
public struct TargetRefWire: Codable, Equatable, Sendable {
  public struct Browser: Codable, Equatable, Sendable {
    public let profileId: String
    public let contextId: String
    public let pageId: String
    /// Bumped by the host on each top-level navigation.
    public let navigationGeneration: Int

    public init(profileId: String, contextId: String, pageId: String, navigationGeneration: Int) {
      self.profileId = profileId
      self.contextId = contextId
      self.pageId = pageId
      self.navigationGeneration = navigationGeneration
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      profileId = try container.identifier(.profileId)
      contextId = try container.refId(.contextId)
      pageId = try container.refId(.pageId)
      navigationGeneration = try container.integer(.navigationGeneration, minimum: 0)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
      case profileId, contextId, pageId, navigationGeneration
    }
  }

  public struct Native: Codable, Equatable, Sendable {
    public let pid: Int
    /// The process start identity, so a reused pid never matches an older ref.
    public let processStart: String
    /// The root surface's window.
    public let windowId: Int?

    public init(pid: Int, processStart: String, windowId: Int?) {
      self.pid = pid
      self.processStart = processStart
      self.windowId = windowId
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      pid = try container.integer(.pid, minimum: 1)
      processStart = try container.string(.processStart, minLength: 1, maxLength: 64)
      windowId = try container.optional(.windowId) { try container.integer($0, minimum: 0) }
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case pid, processStart, windowId }
  }

  public let id: String
  public let bindingId: String
  public let bindingRevision: Int
  public let hostGeneration: Int
  public let engine: ComputerEngineID
  public let engineGeneration: Int
  public let browser: Browser?
  public let native: Native?
  /// What this target supports per step kind, beyond the engine's profile.
  public let capabilities: [TargetCapabilityWire]?

  public init(
    id: String, bindingId: String, bindingRevision: Int, hostGeneration: Int,
    engine: ComputerEngineID, engineGeneration: Int, browser: Browser? = nil,
    native: Native? = nil, capabilities: [TargetCapabilityWire]? = nil
  ) {
    self.id = id
    self.bindingId = bindingId
    self.bindingRevision = bindingRevision
    self.hostGeneration = hostGeneration
    self.engine = engine
    self.engineGeneration = engineGeneration
    self.browser = browser
    self.native = native
    self.capabilities = capabilities.map {
      Array($0.prefix(ComputerWireLimits.maxTargetCapabilities))
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.refId(.id)
    bindingId = try container.identifier(.bindingId)
    bindingRevision = try container.integer(.bindingRevision, minimum: 1)
    hostGeneration = try container.integer(.hostGeneration, minimum: 1)
    engine = try container.value(.engine, ComputerEngineID.self)
    engineGeneration = try container.integer(.engineGeneration, minimum: 1)
    browser = try container.optional(.browser) { try container.value($0, Browser.self) }
    native = try container.optional(.native) { try container.value($0, Native.self) }
    capabilities = try container.optional(.capabilities) {
      try container.array(
        $0, of: TargetCapabilityWire.self, maxItems: ComputerWireLimits.maxTargetCapabilities)
    }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id, bindingId, bindingRevision, hostGeneration, engine, engineGeneration, browser, native
    case capabilities
  }
}
