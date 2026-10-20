import Foundation

/// `ObservationRefSchema`: identity of one observation, invalidated by a navigation, a DOM
/// identity change, an app restart or an engine restart.
public struct ObservationRefWire: Codable, Equatable, Sendable {
  public let id: String
  public let targetRefId: String
  public let version: Int
  public let capturedAt: String

  public init(id: String, targetRefId: String, version: Int, capturedAt: Date) {
    self.id = id
    self.targetRefId = targetRefId
    self.version = version
    self.capturedAt = ComputerWireCoding.timestamp(capturedAt)
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.refId(.id)
    targetRefId = try container.refId(.targetRefId)
    version = try container.integer(.version, minimum: 1)
    capturedAt = try container.string(.capturedAt)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id, targetRefId, version, capturedAt
  }
}

/// `ObservationElementSchema`: one actionable element. The engine truncates `value` and masks
/// secrets before it leaves the host. `frame` is in pixels of the observation's capture and is
/// set only when the observation has one.
public struct ObservationElementWire: Codable, Equatable, Sendable {
  public let ref: String
  public let role: String
  public let name: String?
  public let value: String?
  public let enabled: Bool
  public let focused: Bool?
  public let frame: ComputerRectWire?

  public init(
    ref: String, role: String, name: String? = nil, value: String? = nil, enabled: Bool,
    focused: Bool? = nil, frame: ComputerRectWire? = nil
  ) {
    self.ref = ref
    // An app may leave an element's AX role empty; the contract needs one, so it reads as unknown.
    self.role = role.isEmpty ? "AXUnknown" : role.wireClipped(64)
    self.name = name.map { $0.wireClipped(200) }
    self.value = value.map { $0.wireClipped(200) }
    self.enabled = enabled
    self.focused = focused
    self.frame = frame
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    ref = try container.refId(.ref)
    role = try container.string(.role, minLength: 1, maxLength: 64)
    name = try container.optional(.name) { try container.string($0, maxLength: 200) }
    value = try container.optional(.value) { try container.string($0, maxLength: 200) }
    enabled = try container.boolean(.enabled)
    focused = try container.optional(.focused) { try container.boolean($0) }
    frame = try container.optional(.frame) { try container.value($0, ComputerRectWire.self) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case ref, role, name, value, enabled, focused, frame
  }
}

/// `ObservationSchema`. `screenshot` travels host → service only; the service stores it and
/// strips the base64 before anything reaches the model. `capture` describes the screenshot's
/// geometry, `text` the text recognized in it, and `problems` what the host could not provide.
public struct ObservationWire: Codable, Equatable, Sendable {
  public struct Screenshot: Codable, Equatable, Sendable {
    public typealias Mime = ComputerImageMime

    public let mime: Mime
    public let base64: String

    public init(mime: Mime, base64: String) {
      self.mime = mime
      self.base64 = base64
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      mime = try container.value(.mime, Mime.self)
      base64 = try container.string(
        .base64, minLength: 1, maxLength: ComputerWireLimits.maxScreenshotBase64)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case mime, base64 }
  }

  public let ref: ObservationRefWire
  public let url: String?
  public let title: String?
  public let elements: [ObservationElementWire]
  public let menuItems: [ComputerMenuItemWire]?
  public let screenshot: Screenshot?
  /// The effects the target accepts right now.
  public let capabilities: [ComputerEffect]
  /// The surface observed; nil means the target's root surface.
  public let surfaceRefId: String?
  /// The target's live surfaces.
  public let surfaces: [SurfaceRefWire]?
  public let capture: ComputerCaptureWire?
  public let text: [ComputerTextBoxWire]?
  public let problems: [ComputerObservationProblem]?
  /// When the element tree was read, which may differ from the capture's time.
  public let treeCapturedAt: String?

  public init(
    ref: ObservationRefWire, url: String? = nil, title: String? = nil,
    elements: [ObservationElementWire], screenshot: Screenshot? = nil,
    capabilities: [ComputerEffect], surfaceRefId: String? = nil,
    surfaces: [SurfaceRefWire]? = nil, capture: ComputerCaptureWire? = nil,
    text: [ComputerTextBoxWire]? = nil, problems: [ComputerObservationProblem]? = nil,
    treeCapturedAt: String? = nil, menuItems: [ComputerMenuItemWire]? = nil
  ) {
    self.ref = ref
    self.url = url.map { $0.wireClipped(2048) }
    self.title = title.map { $0.wireClipped(500) }
    self.elements = Array(elements.prefix(ComputerWireLimits.maxElements))
    self.menuItems = menuItems
    self.screenshot = screenshot
    self.capabilities = capabilities
    self.surfaceRefId = surfaceRefId
    self.surfaces = surfaces.map { Array($0.prefix(ComputerWireLimits.maxSurfaces)) }
    self.capture = capture
    self.text = text.map { Array($0.prefix(ComputerWireLimits.maxTextBoxes)) }
    // Unique, as the contract requires; a host reporting one problem twice still sends it once.
    self.problems = problems.map { $0.reduce(into: []) { if !$0.contains($1) { $0.append($1) } } }
    self.treeCapturedAt = treeCapturedAt
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    ref = try container.value(.ref, ObservationRefWire.self)
    url = try container.optional(.url) { try container.string($0, maxLength: 2048) }
    title = try container.optional(.title) { try container.string($0, maxLength: 500) }
    elements = try container.array(
      .elements, of: ObservationElementWire.self, maxItems: ComputerWireLimits.maxElements)
    menuItems = try container.optional(.menuItems) {
      try container.array(
        $0, of: ComputerMenuItemWire.self, maxItems: ComputerWireLimits.maxElements)
    }
    screenshot = try container.optional(.screenshot) { try container.value($0, Screenshot.self) }
    capabilities = try container.array(
      .capabilities, of: ComputerEffect.self, maxItems: 8, uniqueItems: true)
    surfaceRefId = try container.optional(.surfaceRefId) { try container.refId($0) }
    surfaces = try container.optional(.surfaces) {
      try container.array(
        $0, of: SurfaceRefWire.self, maxItems: ComputerWireLimits.maxSurfaces)
    }
    capture = try container.optional(.capture) { try container.value($0, ComputerCaptureWire.self) }
    text = try container.optional(.text) {
      try container.array(
        $0, of: ComputerTextBoxWire.self, maxItems: ComputerWireLimits.maxTextBoxes)
    }
    problems = try container.optional(.problems) {
      try container.array(
        $0, of: ComputerObservationProblem.self, maxItems: 6, uniqueItems: true)
    }
    treeCapturedAt = try container.optional(.treeCapturedAt) { try container.string($0) }
    if capture == nil, elements.contains(where: { $0.frame != nil }) {
      throw DecodingError.dataCorruptedError(
        forKey: .elements, in: container,
        debugDescription: "Element frames need the observation's capture.")
    }
  }

  /// The same observation without its screenshot, as the host keeps it for baselines.
  public var withoutScreenshot: ObservationWire {
    ObservationWire(
      ref: ref, url: url, title: title, elements: elements, capabilities: capabilities,
      surfaceRefId: surfaceRefId, surfaces: surfaces, capture: capture, text: text,
      problems: problems, treeCapturedAt: treeCapturedAt, menuItems: menuItems)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case ref, url, title, elements, screenshot, capabilities, surfaceRefId, surfaces, capture
    case text, problems, treeCapturedAt, menuItems
  }
}

/// The `observe` operation: what to read of a target's surface (its root unless `surfaceRefId`
/// names another). `region`, in pixels of an earlier capture, asks for the same window area
/// captured again and cropped. The service sends at least one of `tree` and `screenshot`, and
/// `text` only with `screenshot`; ``refusal`` names a request that breaks that, which the host
/// answers `unsupported`.
public struct ObserveOperationWire: Equatable, Sendable {
  public struct Include: Decodable, Equatable, Sendable {
    public let tree: Bool
    public let screenshot: Bool
    public let text: Bool

    public init(tree: Bool, screenshot: Bool, text: Bool) {
      self.tree = tree
      self.screenshot = screenshot
      self.text = text
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      tree = try container.boolean(.tree)
      screenshot = try container.boolean(.screenshot)
      text = try container.boolean(.text)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case tree, screenshot, text }
  }

  public struct Region: Codable, Equatable, Sendable {
    public let capture: String
    public let rect: ComputerRectWire

    public init(capture: String, rect: ComputerRectWire) {
      self.capture = capture
      self.rect = rect
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      capture = try container.refId(.capture)
      rect = try container.value(.rect, ComputerRectWire.self)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case capture, rect }
  }

  public let targetRef: TargetRefWire
  public let surfaceRefId: String?
  public let include: Include
  public let region: Region?

  public init(
    targetRef: TargetRefWire, surfaceRefId: String? = nil, include: Include, region: Region? = nil
  ) {
    self.targetRef = targetRef
    self.surfaceRefId = surfaceRefId
    self.include = include
    self.region = region
  }

  /// Why the host cannot answer this request as asked; nil when it is well formed.
  public var refusal: String? {
    if !include.tree, !include.screenshot {
      return "An observation needs the tree or a screenshot."
    }
    if include.text, !include.screenshot { return "Recognized text needs a screenshot." }
    return nil
  }
}
