import Foundation

/// `ComputerGeometrySchema`: where a step acts. `screen` is Quartz global display points on
/// `displayId` (y down from the primary display's top-left), as the engine verified them;
/// `viewport` is CSS pixels of a page; `image` is pixels of one screenshot; `unavailable` means no
/// trusted position. Only `screen` may ever reach the live pointer.
public enum ComputerGeometryWire: Codable, Equatable, Sendable {
  case screen(displayId: Int, rect: ComputerRectWire)
  case viewport(pageId: String, rect: ComputerRectWire, width: Double, height: Double)
  case image(resourceId: String?, rect: ComputerRectWire, width: Double, height: Double)
  case unavailable

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
    switch kind {
    case "screen":
      let container = try BridgeCoding.keyed(decoder, ScreenKeys.self)
      self = .screen(
        displayId: try container.integer(.displayId, minimum: 0),
        rect: try container.value(.rect, ComputerRectWire.self))
    case "viewport":
      let container = try BridgeCoding.keyed(decoder, ViewportKeys.self)
      let size = try container.value(.viewport, Size.self)
      self = .viewport(
        pageId: try container.refId(.pageId),
        rect: try container.value(.rect, ComputerRectWire.self),
        width: size.width, height: size.height)
    case "image":
      let container = try BridgeCoding.keyed(decoder, ImageKeys.self)
      let size = try container.value(.size, Size.self)
      self = .image(
        resourceId: try container.optional(.resourceId) { try container.identifier($0) },
        rect: try container.value(.rect, ComputerRectWire.self), width: size.width,
        height: size.height)
    case "unavailable":
      _ = try BridgeCoding.keyed(decoder, UnavailableKeys.self)
      self = .unavailable
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown geometry \(kind)."))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    switch self {
    case .screen(let displayId, let rect):
      try container.encode("screen", forKey: .kind)
      try container.encode(displayId, forKey: .displayId)
      try container.encode(rect, forKey: .rect)
    case .viewport(let pageId, let rect, let width, let height):
      try container.encode("viewport", forKey: .kind)
      try container.encode(pageId, forKey: .pageId)
      try container.encode(rect, forKey: .rect)
      try container.encode(Size(width: width, height: height), forKey: .viewport)
    case .image(let resourceId, let rect, let width, let height):
      try container.encode("image", forKey: .kind)
      try container.encodeIfPresent(resourceId, forKey: .resourceId)
      try container.encode(rect, forKey: .rect)
      try container.encode(Size(width: width, height: height), forKey: .size)
    case .unavailable:
      try container.encode("unavailable", forKey: .kind)
    }
  }

  private struct Size: Codable {
    let width: Double
    let height: Double

    init(width: Double, height: Double) {
      self.width = max(0, width)
      self.height = max(0, height)
    }

    init(from decoder: any Decoder) throws {
      let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
      width = try container.number(.width, minimum: 0)
      height = try container.number(.height, minimum: 0)
    }

    private enum CodingKeys: String, CodingKey, CaseIterable { case width, height }
  }

  private enum Keys: String, CodingKey {
    case kind, displayId, rect, pageId, viewport, resourceId, size
  }
  private enum ScreenKeys: String, CodingKey, CaseIterable { case kind, displayId, rect }
  private enum ViewportKeys: String, CodingKey, CaseIterable { case kind, pageId, rect, viewport }
  private enum ImageKeys: String, CodingKey, CaseIterable { case kind, resourceId, rect, size }
  private enum UnavailableKeys: String, CodingKey, CaseIterable { case kind }
}

/// `ComputerProgressPhaseSchema`.
public enum ComputerProgressPhase: String, Codable, Sendable {
  case locating, dispatching, waiting, verifying, done, failed, cleared
}

/// `ComputerProgressSchema`: live progress of the action a host is carrying out, display state
/// only. The host generates it from its own lifecycle events; `seq` increases across the whole
/// host generation, so it also increases per run and per operation.
public struct ComputerProgressWire: Codable, Equatable, Sendable {
  public let taskId: String
  public let runId: String
  public let operationId: String
  public let actionId: String
  public let hostGeneration: Int
  public let seq: Int
  public let phase: ComputerProgressPhase
  public let observationRefId: String?
  public let validUntil: String
  public let label: ComputerStepKind?
  public let geometry: ComputerGeometryWire

  public init(
    taskId: String, runId: String, operationId: String, actionId: String, hostGeneration: Int,
    seq: Int, phase: ComputerProgressPhase, observationRefId: String?, validUntil: Date,
    label: ComputerStepKind?, geometry: ComputerGeometryWire
  ) {
    self.taskId = taskId
    self.runId = runId
    self.operationId = operationId
    self.actionId = actionId
    self.hostGeneration = hostGeneration
    self.seq = seq
    self.phase = phase
    self.observationRefId = observationRefId
    self.validUntil = ComputerWireCoding.timestamp(validUntil)
    self.label = label
    self.geometry = geometry
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    taskId = try container.identifier(.taskId)
    runId = try container.identifier(.runId)
    operationId = try container.operationId(.operationId)
    actionId = try container.actionId(.actionId)
    hostGeneration = try container.integer(.hostGeneration, minimum: 1)
    seq = try container.integer(.seq, minimum: 0)
    phase = try container.value(.phase, ComputerProgressPhase.self)
    observationRefId = try container.optional(.observationRefId) { try container.refId($0) }
    validUntil = try container.string(.validUntil)
    label = try container.optional(.label) { try container.value($0, ComputerStepKind.self) }
    geometry = try container.value(.geometry, ComputerGeometryWire.self)
  }

  /// `isNewerProgress`: a newer host generation, or a higher `seq` within the same one.
  public func supersedes(_ current: ComputerProgressWire?) -> Bool {
    guard let current else { return true }
    if hostGeneration != current.hostGeneration { return hostGeneration > current.hostGeneration }
    return seq > current.seq
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case taskId, runId, operationId, actionId, hostGeneration, seq, phase, observationRefId
    case validUntil, label, geometry
  }
}
