import Foundation

/// `CapabilityProfileSchema`: what one engine of this host can actually do, published in
/// `computer.hello`. `delivery` lists the ways the engine can deliver input: always `background`,
/// and `foreground` where the engine has the foreground fallback for requests that allow it;
/// `affectsSystemInput` whether the engine's input can still move the shared pointer or keyboard
/// focus. The foreground fallback brings the target app forward for a step, which no unattended
/// request allows, but its input is posted to the target's process like the background's.
public struct CapabilityProfileWire: Codable, Equatable, Sendable {
  public enum Arch: String, Codable, Sendable {
    case arm64
    case x8664 = "x86_64"
  }

  public enum Qualification: String, Codable, Sendable {
    case qualified
    case unqualified
  }

  public let engine: ComputerEngineID
  public let engineVersion: String
  public let os: String
  public let arch: Arch
  public let targetKinds: [ComputerTargetKind]
  public let actions: [ComputerStepKind]
  public let effects: [ComputerEffect]
  public let delivery: [ComputerDelivery]
  public let affectsSystemInput: Bool
  public let qualification: Qualification
  public let evidence: String

  public init(
    engine: ComputerEngineID, engineVersion: String, os: String, arch: Arch,
    targetKinds: [ComputerTargetKind], actions: [ComputerStepKind], effects: [ComputerEffect],
    delivery: [ComputerDelivery], affectsSystemInput: Bool, qualification: Qualification,
    evidence: String
  ) {
    self.engine = engine
    self.engineVersion = engineVersion.wireClipped(64)
    self.os = os.wireClipped(64)
    self.arch = arch
    self.targetKinds = targetKinds
    self.actions = actions
    self.effects = effects
    self.delivery = delivery
    self.affectsSystemInput = affectsSystemInput
    self.qualification = qualification
    self.evidence = evidence.wireClipped(500)
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    engine = try container.value(.engine, ComputerEngineID.self)
    engineVersion = try container.string(.engineVersion, minLength: 1, maxLength: 64)
    os = try container.string(.os, minLength: 1, maxLength: 64)
    arch = try container.value(.arch, Arch.self)
    targetKinds = try container.array(
      .targetKinds, of: ComputerTargetKind.self, minItems: 1, maxItems: 2, uniqueItems: true)
    actions = try container.array(
      .actions, of: ComputerStepKind.self, maxItems: 16, uniqueItems: true)
    effects = try container.array(.effects, of: ComputerEffect.self, maxItems: 8, uniqueItems: true)
    delivery = try container.array(
      .delivery, of: ComputerDelivery.self, minItems: 1, maxItems: 2, uniqueItems: true)
    affectsSystemInput = try container.boolean(.affectsSystemInput)
    qualification = try container.value(.qualification, Qualification.self)
    evidence = try container.string(.evidence, maxLength: 500)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case engine, engineVersion, os, arch, targetKinds, actions, effects, delivery
    case affectsSystemInput, qualification, evidence
  }
}

/// `TargetCapabilitySchema`: what one target supports for one step kind, as the host found it.
/// `delivery` lists `background` when a background route is open for the step, and `foreground`
/// when the foreground fallback could do it instead, which the host lists only in answer to a
/// request that allows the foreground; empty, the action is unavailable on this target. `routes`
/// lists the background routes the host can take for it here (nil when the host does not say);
/// `verified` says the host confirmed it works here rather than inferring it from the engine.
public struct TargetCapabilityWire: Codable, Equatable, Sendable {
  /// How the step may name what it acts on: an element ref, a semantic locator, an image point.
  public enum Locate: String, Codable, CaseIterable, Sendable {
    case element
    case semantic
    case image
  }

  public let action: ComputerStepKind
  public let locate: [Locate]
  public let delivery: [ComputerDelivery]
  public let routes: [ActionResultWire.Route]?
  public let verified: Bool

  /// `routes` keeps its first occurrences in order, at most
  /// ``ComputerWireLimits/maxCapabilityRoutes``, since the contract refuses repeated items.
  public init(
    action: ComputerStepKind, locate: [Locate], delivery: [ComputerDelivery], verified: Bool,
    routes: [ActionResultWire.Route]? = nil
  ) {
    self.action = action
    self.locate = Array(locate.prefix(3))
    self.delivery = Array(delivery.prefix(2))
    self.routes = routes.map { listed in
      var seen = Set<ActionResultWire.Route>()
      return Array(
        listed.filter { seen.insert($0).inserted }.prefix(ComputerWireLimits.maxCapabilityRoutes))
    }
    self.verified = verified
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    action = try container.value(.action, ComputerStepKind.self)
    locate = try container.array(.locate, of: Locate.self, maxItems: 3, uniqueItems: true)
    delivery = try container.array(
      .delivery, of: ComputerDelivery.self, maxItems: 2, uniqueItems: true)
    routes = try container.optional(.routes) {
      try container.array(
        $0, of: ActionResultWire.Route.self, maxItems: ComputerWireLimits.maxCapabilityRoutes,
        uniqueItems: true)
    }
    verified = try container.boolean(.verified)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case action, locate, delivery, routes, verified
  }
}
