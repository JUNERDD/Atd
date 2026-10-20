import Foundation

/// `ComputerLocatorSchema` (also `ComputerElementLocatorSchema`): an element ref valid only for the
/// observation it came from, or a semantic description the engine resolves to exactly one element
/// (or fails `ambiguous` / `notFound`).
public enum ComputerLocatorWire: Codable, Equatable, Sendable {
  case ref(String)
  case semantic(Semantic)

  public struct Semantic: Codable, Equatable, Sendable {
    public let role: String?
    public let name: String?
    public let label: String?
    public let placeholder: String?
    public let text: String?

    public init(
      role: String? = nil, name: String? = nil, label: String? = nil, placeholder: String? = nil,
      text: String? = nil
    ) {
      self.role = role
      self.name = name
      self.label = label
      self.placeholder = placeholder
      self.text = text
    }

    public init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      let field = { (key: CodingKeys, max: Int) in
        try container.optional(key) { try container.string($0, minLength: 1, maxLength: max) }
      }
      role = try field(.role, 64)
      name = try field(.name, 200)
      label = try field(.label, 200)
      placeholder = try field(.placeholder, 200)
      text = try field(.text, 200)
      guard [role, name, label, placeholder, text].contains(where: { $0 != nil }) else {
        throw DecodingError.dataCorrupted(
          .init(codingPath: decoder.codingPath, debugDescription: "A locator needs a field."))
      }
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
      case role, name, label, placeholder, text
    }
  }

  public init(from decoder: any Decoder) throws {
    let members = try decoder.container(keyedBy: BridgeCoding.AnyKey.self)
    if members.contains(BridgeCoding.AnyKey(stringValue: "ref")) {
      self = .ref(try BridgeCoding.keyed(decoder, RefKeys.self).refId(.ref))
    } else {
      self = .semantic(try Semantic(from: decoder))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .ref(let ref):
      var container = encoder.container(keyedBy: RefKeys.self)
      try container.encode(ref, forKey: .ref)
    case .semantic(let semantic): try semantic.encode(to: encoder)
    }
  }

  private enum RefKeys: String, CodingKey, CaseIterable { case ref }
}

/// `ComputerElementLocatorSchema`, the contract's name for a locator that names an element.
public typealias ComputerElementLocatorWire = ComputerLocatorWire

/// `ComputerImagePointSchema`: a pixel of capture `capture`, as its `width` and `height` report
/// it, origin top-left. The host maps it to the capture's window again and refuses it when that
/// capture is no longer current.
public struct ComputerImagePointWire: Codable, Equatable, Sendable {
  public let capture: String
  public let x: Int
  public let y: Int

  public init(capture: String, x: Int, y: Int) {
    self.capture = capture
    self.x = max(0, x)
    self.y = max(0, y)
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    capture = try container.refId(.capture)
    x = try container.integer(.x, minimum: 0)
    y = try container.integer(.y, minimum: 0)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable { case capture, x, y }
}

/// `ComputerPointLocatorSchema`: an element (by ref or semantically), or a point of a capture.
/// An object naming `capture` is an image point; anything else must be an element locator.
public enum ComputerPointLocatorWire: Codable, Equatable, Sendable {
  case element(ComputerLocatorWire)
  case imagePoint(ComputerImagePointWire)

  /// The element locator, nil for an image point.
  public var element: ComputerLocatorWire? {
    if case .element(let locator) = self { locator } else { nil }
  }

  public var isImagePoint: Bool { element == nil }

  public init(from decoder: any Decoder) throws {
    let members = try decoder.container(keyedBy: BridgeCoding.AnyKey.self)
    if members.contains(BridgeCoding.AnyKey(stringValue: "capture")) {
      self = .imagePoint(try ComputerImagePointWire(from: decoder))
    } else {
      self = .element(try ComputerLocatorWire(from: decoder))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .element(let locator): try locator.encode(to: encoder)
    case .imagePoint(let point): try point.encode(to: encoder)
    }
  }
}

/// `ComputerConditionSchema`: what a host checks before a step (`wait`), after an action
/// (`postcondition`) or as an automation's completion.
public enum ComputerConditionWire: Codable, Equatable, Sendable {
  case enabled(locator: ComputerLocatorWire)
  case valueEquals(locator: ComputerLocatorWire, text: String)
  case textAppears(text: String)
  case menuItemAvailable(path: [String])
  /// A prefix of the page URL.
  case urlMatches(pattern: String)
  /// A completion identifier absent at the action's baseline observation.
  case newText(
    locator: ComputerLocatorWire?, pattern: String?, region: ObserveOperationWire.Region? = nil)

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
    switch kind {
    case "menuItemAvailable":
      let container = try Self.closed(decoder, [.kind, .path])
      self = .menuItemAvailable(path: try ComputerMenuItemWire.path(container, key: .path))
    case "enabled":
      let container = try Self.closed(decoder, [.kind, .locator])
      self = .enabled(locator: try container.value(.locator, ComputerLocatorWire.self))
    case "valueEquals":
      let container = try Self.closed(decoder, [.kind, .locator, .text])
      self = .valueEquals(
        locator: try container.value(.locator, ComputerLocatorWire.self),
        text: try container.string(.text, maxLength: ComputerWireLimits.maxTextLength))
    case "textAppears":
      let container = try Self.closed(decoder, [.kind, .text])
      self = .textAppears(text: try container.string(.text, minLength: 1, maxLength: 500))
    case "urlMatches":
      let container = try Self.closed(decoder, [.kind, .pattern])
      self = .urlMatches(pattern: try container.computerURL(.pattern))
    case "newText":
      let container = try Self.closed(decoder, [.kind, .locator, .pattern, .region])
      self = .newText(
        locator: try container.optional(.locator) {
          try container.value($0, ComputerLocatorWire.self)
        },
        pattern: try container.optional(.pattern) {
          try container.string($0, minLength: 1, maxLength: 200)
        },
        region: try container.optional(.region) {
          try container.value($0, ObserveOperationWire.Region.self)
        })
      if case .newText(.some, _, .some) = self {
        throw DecodingError.dataCorrupted(
          .init(
            codingPath: decoder.codingPath,
            debugDescription: "newText cannot combine locator and region."))
      }
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown condition \(kind)."))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .menuItemAvailable(let path):
      try container.encode("menuItemAvailable", forKey: .kind)
      try container.encode(path, forKey: .path)
    case .enabled(let locator):
      try container.encode("enabled", forKey: .kind)
      try container.encode(locator, forKey: .locator)
    case .valueEquals(let locator, let text):
      try container.encode("valueEquals", forKey: .kind)
      try container.encode(locator, forKey: .locator)
      try container.encode(text, forKey: .text)
    case .textAppears(let text):
      try container.encode("textAppears", forKey: .kind)
      try container.encode(text, forKey: .text)
    case .urlMatches(let pattern):
      try container.encode("urlMatches", forKey: .kind)
      try container.encode(pattern, forKey: .pattern)
    case .newText(let locator, let pattern, let region):
      try container.encode("newText", forKey: .kind)
      try container.encodeIfPresent(locator, forKey: .locator)
      try container.encodeIfPresent(pattern, forKey: .pattern)
      try container.encodeIfPresent(region, forKey: .region)
    }
  }

  /// The members of one variant, refusing any other.
  private static func closed(_ decoder: any Decoder, _ allowed: Set<Keys>) throws
    -> KeyedDecodingContainer<Keys>
  {
    let members = try decoder.container(keyedBy: BridgeCoding.AnyKey.self)
    let names = Set(allowed.map(\.rawValue))
    if let extra = members.allKeys.first(where: { !names.contains($0.stringValue) }) {
      throw DecodingError.dataCorruptedError(
        forKey: extra, in: members, debugDescription: "Unexpected member \(extra.stringValue).")
    }
    return try decoder.container(keyedBy: Keys.self)
  }

  private enum Keys: String, CodingKey, CaseIterable {
    case kind, locator, text, pattern, path, region
  }
}

/// `ComputerActionSchema`: the action as the host receives it, `actionId` always set. The service
/// keeps the input-only `resolves` to itself; it never reaches the host. The action names no
/// delivery or route: the host picks each step's background route.
public struct ComputerActionWire: Decodable, Equatable, Sendable {
  public let actionId: String
  public let targetRefId: String
  public let observationRefId: String
  public let steps: [ComputerStepWire]
  public let postcondition: ComputerConditionWire?
  public let recipeStepId: String?
  /// The surface the steps act on; nil means the target's root surface.
  public let surfaceRefId: String?

  public init(
    actionId: String, targetRefId: String, observationRefId: String, steps: [ComputerStepWire],
    postcondition: ComputerConditionWire? = nil, recipeStepId: String? = nil,
    surfaceRefId: String? = nil
  ) {
    self.actionId = actionId
    self.targetRefId = targetRefId
    self.observationRefId = observationRefId
    self.steps = steps
    self.postcondition = postcondition
    self.recipeStepId = recipeStepId
    self.surfaceRefId = surfaceRefId
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    actionId = try container.actionId(.actionId)
    targetRefId = try container.refId(.targetRefId)
    observationRefId = try container.refId(.observationRefId)
    steps = try container.array(
      .steps, of: ComputerStepWire.self, minItems: 1, maxItems: ComputerWireLimits.maxSteps)
    postcondition = try container.optional(.postcondition) {
      try container.value($0, ComputerConditionWire.self)
    }
    recipeStepId = try container.optional(.recipeStepId) {
      try container.string($0, minLength: 1, maxLength: 64, pattern: ComputerPattern.stepId)
    }
    surfaceRefId = try container.optional(.surfaceRefId) { try container.refId($0) }
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case actionId, targetRefId, observationRefId, steps, postcondition, recipeStepId
    case surfaceRefId
  }
}
