import Foundation

/// `SurfaceRefSchema`: one live surface of a target (its root window, or a sheet, dialog, panel,
/// menu or popover that belongs to it), minted by the host. `generation` bumps when the host can
/// no longer prove the surface is the one it listed, so an older id never matches a new surface;
/// `basis` records why the host counts the surface as the target's.
public struct SurfaceRefWire: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, CaseIterable, Sendable {
    case window, sheet, dialog, panel, menu, popover
  }

  public enum Basis: String, Codable, CaseIterable, Sendable {
    /// The target's root window.
    case root
    /// A sheet attached to a surface of the target.
    case attachedSheet
    /// A window the target's root window owns.
    case ownedWindow
    /// A panel a system service shows on the target's behalf, such as an open or save panel.
    case servicePanel
    /// A surface that appeared in response to an action on the target.
    case openedByAction
  }

  public let id: String
  public let targetRefId: String
  public let parentId: String?
  public let kind: Kind
  public let title: String?
  public let pid: Int
  public let processStart: String
  public let windowId: Int?
  public let generation: Int
  public let basis: Basis
  /// Whether the surface blocks input to its parent while it is open.
  public let modal: Bool

  public init(
    id: String, targetRefId: String, parentId: String? = nil, kind: Kind, title: String? = nil,
    pid: Int, processStart: String, windowId: Int? = nil, generation: Int, basis: Basis,
    modal: Bool
  ) {
    self.id = id
    self.targetRefId = targetRefId
    self.parentId = parentId
    self.kind = kind
    self.title = title.map { $0.wireClipped(200) }
    self.pid = pid
    self.processStart = processStart.wireClipped(64)
    self.windowId = windowId
    self.generation = max(1, generation)
    self.basis = basis
    self.modal = modal
  }

  public init(from decoder: any Decoder) throws {
    let container = try BridgeCoding.keyed(decoder, CodingKeys.self)
    id = try container.refId(.id)
    targetRefId = try container.refId(.targetRefId)
    parentId = try container.optional(.parentId) { try container.refId($0) }
    kind = try container.value(.kind, Kind.self)
    title = try container.optional(.title) { try container.string($0, maxLength: 200) }
    pid = try container.integer(.pid, minimum: 1)
    processStart = try container.string(.processStart, minLength: 1, maxLength: 64)
    windowId = try container.optional(.windowId) { try container.integer($0, minimum: 0) }
    generation = try container.integer(.generation, minimum: 1)
    basis = try container.value(.basis, Basis.self)
    modal = try container.boolean(.modal)
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id, targetRefId, parentId, kind, title, pid, processStart, windowId, generation, basis
    case modal
  }
}
