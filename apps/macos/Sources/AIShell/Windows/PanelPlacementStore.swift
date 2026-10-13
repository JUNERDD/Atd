import AICore
import Foundation

/// The panel's placement preference (`panel.placement`, ``PanelPlacement``; bottom-right until
/// changed) and where the user last left the panel on each display (`panel.positions`), kept by
/// the shell in UserDefaults. Positions are keyed by display UUID (``NSScreen/displayUUID``), so
/// a display keeps its place across launches, reconnections and rearranged displays. A position
/// is recorded whatever the preference, so choosing Last position later starts from it. The map
/// stays small (one entry per display ever used), so it is not pruned.
final class PanelPlacementStore {
  private let defaults: UserDefaults
  private var positions: [String: PanelOffset]

  private static let placementKey = "panel.placement"
  private static let positionsKey = "panel.positions"

  init(defaults: UserDefaults) {
    self.defaults = defaults
    positions =
      defaults.data(forKey: Self.positionsKey).flatMap {
        try? JSONDecoder().decode([String: PanelOffset].self, from: $0)
      } ?? [:]
  }

  var placement: PanelPlacement {
    get {
      defaults.string(forKey: Self.placementKey).flatMap(PanelPlacement.init(rawValue:))
        ?? .bottomRight
    }
    set { defaults.set(newValue.rawValue, forKey: Self.placementKey) }
  }

  /// Where the user last left the panel on the display, if anywhere.
  func position(onDisplay uuid: String) -> PanelOffset? {
    positions[uuid]
  }

  func remember(_ offset: PanelOffset, onDisplay uuid: String) {
    guard positions[uuid] != offset else { return }
    positions[uuid] = offset
    if let data = try? JSONEncoder().encode(positions) {
      defaults.set(data, forKey: Self.positionsKey)
    }
  }
}
