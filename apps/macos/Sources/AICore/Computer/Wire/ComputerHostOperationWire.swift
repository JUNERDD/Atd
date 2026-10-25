import Foundation

/// `HostOperationSchema`: what the service asks the host to do.
public enum HostOperationWire: Decodable, Equatable, Sendable {
  case prepareAccess(ComputerAccessTargetWire)
  case openAccess(OpenComputerAccessWire)
  case targets([TargetBindingWire])
  case observe(ObserveOperationWire)
  case act(ComputerActionWire)
  case status(actionIds: [String])
  case release(TargetRefWire)
  case screenShare(ScreenShareOperationWire)
  case screenContext(ScreenContextOperationWire)

  /// The operation's kind as the contract names it, for logs and errors.
  public var kind: String {
    switch self {
    case .prepareAccess: "prepareAccess"
    case .openAccess: "openAccess"
    case .targets: "targets"
    case .observe: "observe"
    case .act: "act"
    case .status: "status"
    case .release: "release"
    case .screenShare: "screenShare"
    case .screenContext: "screenContext"
    }
  }

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .kind)
    switch kind {
    case "screenShare": self = .screenShare(try ScreenShareOperationWire(from: decoder))
    case "screenContext": self = .screenContext(try ScreenContextOperationWire(from: decoder))
    case "prepareAccess":
      let container = try BridgeCoding.keyed(decoder, AccessKeys.self)
      self = .prepareAccess(try container.value(.target, ComputerAccessTargetWire.self))
    case "openAccess":
      self = .openAccess(try OpenComputerAccessWire(from: decoder))
    case "targets":
      let container = try BridgeCoding.keyed(decoder, TargetsKeys.self)
      self = .targets(
        try container.array(
          .bindings, of: TargetBindingWire.self, maxItems: ComputerWireLimits.maxRunBindings))
    case "observe":
      let container = try BridgeCoding.keyed(decoder, ObserveKeys.self)
      self = .observe(
        ObserveOperationWire(
          targetRef: try container.value(.targetRef, TargetRefWire.self),
          surfaceRefId: try container.optional(.surfaceRefId) { try container.refId($0) },
          include: try container.value(.include, ObserveOperationWire.Include.self),
          region: try container.optional(.region) {
            try container.value($0, ObserveOperationWire.Region.self)
          }))
    case "act":
      let container = try BridgeCoding.keyed(decoder, ActKeys.self)
      self = .act(try container.value(.action, ComputerActionWire.self))
    case "status":
      let container = try BridgeCoding.keyed(decoder, StatusKeys.self)
      let ids = try container.array(
        .actionIds, of: String.self, maxItems: ComputerWireLimits.maxStatusIds)
      guard ids.allSatisfy({ BridgeCoding.matches($0, ComputerPattern.actionId) }) else {
        throw DecodingError.dataCorruptedError(
          forKey: .actionIds, in: container, debugDescription: "actionIds must be UUIDs.")
      }
      self = .status(actionIds: ids)
    case "release":
      let container = try BridgeCoding.keyed(decoder, ReleaseKeys.self)
      self = .release(try container.value(.targetRef, TargetRefWire.self))
    default:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "Unknown operation \(kind)."))
    }
  }

  private enum AccessKeys: String, CodingKey, CaseIterable { case kind, target }
  private enum Keys: String, CodingKey { case kind }
  private enum TargetsKeys: String, CodingKey, CaseIterable { case kind, bindings }
  private enum ObserveKeys: String, CodingKey, CaseIterable {
    case kind, targetRef, surfaceRefId, include, region
  }
  private enum ActKeys: String, CodingKey, CaseIterable { case kind, action }
  private enum StatusKeys: String, CodingKey, CaseIterable { case kind, actionIds }
  private enum ReleaseKeys: String, CodingKey, CaseIterable { case kind, targetRef }
}
