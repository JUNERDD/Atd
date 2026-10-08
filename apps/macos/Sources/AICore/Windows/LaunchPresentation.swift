/// Chooses the first launch window from the service settings, while preserving a quiet login,
/// file, widget or notification launch. A service failure exposes a requested panel once, but
/// leaves the first-run decision pending so recovery can still open the welcome guide.
public struct LaunchPresentation: Sendable {
  public enum Destination: Equatable, Sendable {
    case panel
    case onboarding
  }

  private var revealPanel: Bool
  private var resolved = false

  public init(revealPanel: Bool) {
    self.revealPanel = revealPanel
  }

  public mutating func resolve(_ state: AppStartupParams.State) -> Destination? {
    guard !resolved else { return nil }
    if state != .unavailable { resolved = true }
    if state == .onboarding { return .onboarding }
    guard revealPanel else { return nil }
    revealPanel = false
    return .panel
  }
}
