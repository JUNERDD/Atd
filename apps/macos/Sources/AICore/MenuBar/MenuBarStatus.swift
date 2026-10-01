/// The menu bar status item's four images, in priority order: the first that applies wins.
/// The raw values name the template images (`<state>Template`).
public enum MenuBarState: String, CaseIterable, Sendable {
  case unavailable
  case attention
  case running
  case idle
}

/// How reachable the agent service is, as the relay reports it.
public enum ServiceAvailability: Equatable, Sendable {
  /// Starting or connecting for the first time; the last known counts stay shown, which
  /// avoids flashing the unavailable state on every launch.
  case connecting
  case available
  /// Down, reconnecting, or given up. `development` is a Debug build waiting for `pnpm dev`.
  case unavailable(development: Bool)
}

/// What the status item shows. Counts come from the service's `status` frame, which already
/// counts root tasks only, with attention taking precedence over running (plan P2).
public struct MenuBarStatus: Equatable, Sendable {
  public let state: MenuBarState
  public let running: Int
  public let attention: Int
  /// Show the "run pnpm dev" hint.
  public let developmentHint: Bool

  public init(availability: ServiceAvailability, running: Int, attention: Int) {
    self.running = max(running, 0)
    self.attention = max(attention, 0)
    switch availability {
    case .unavailable(let development):
      state = .unavailable
      developmentHint = development
    case .connecting, .available:
      developmentHint = false
      state = self.attention > 0 ? .attention : self.running > 0 ? .running : .idle
    }
  }
}
