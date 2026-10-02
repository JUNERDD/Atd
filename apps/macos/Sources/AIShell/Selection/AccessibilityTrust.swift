import AppKit
import ApplicationServices

/// Whether the app is trusted for Accessibility, which selection capture and the selection
/// toolbar need, and when the system asks for it (grill decision Q7):
/// - the first launch with the toolbar on asks once, remembered in this bundle id's defaults,
///   so Debug and Release builds each ask once ever and never again by themselves;
/// - after that only a summon that wants the selection asks (once per launch), or the
///   settings page's permission row (`accessibility.request`).
///
/// Trust is re-read every 2 s while missing, so granting it in System Settings takes effect
/// without a restart, and when the system posts that the trusted list changed, so a revoked
/// grant is noticed too. ``onChange`` reports every change.
final class AccessibilityTrust {
  private(set) var isTrusted: Bool
  var onChange: ((Bool) -> Void)?

  private let defaults: UserDefaults
  private var promptedThisLaunch = false
  private var poll: Timer?
  private var listObserver: NSObjectProtocol?

  private static let autoPromptedKey = "accessibility.autoPrompted"
  /// Posted by the system when an app's Accessibility grant changes.
  private static let listChanged = Notification.Name("com.apple.accessibility.api")
  private static let settingsURL = URL(
    string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    isTrusted = SelectionReader.isTrusted
  }

  func start() {
    listObserver = DistributedNotificationCenter.default().addObserver(
      forName: Self.listChanged, object: nil, queue: .main
    ) { [weak self] _ in
      // The grant settles shortly after the notification.
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
        MainActor.assumeIsolated { self?.refresh() }
      }
    }
    refresh()
    updatePolling()
  }

  /// The once-ever prompt of a first launch with the toolbar on.
  func promptOnFirstLaunch() {
    guard !isTrusted, !defaults.bool(forKey: Self.autoPromptedKey) else { return }
    defaults.set(true, forKey: Self.autoPromptedKey)
    promptOncePerLaunch()
  }

  /// The system prompt, at most once per launch, for a summon that wants the selection.
  func promptOncePerLaunch() {
    guard !isTrusted, !promptedThisLaunch else { return }
    promptedThisLaunch = true
    SelectionReader.requestTrust()
  }

  /// `accessibility.request`: the prompt under the same once-per-launch rule (it also lists the
  /// app in System Settings), then Privacy & Security › Accessibility.
  func openSystemSettings() {
    promptOncePerLaunch()
    if let url = Self.settingsURL { NSWorkspace.shared.open(url) }
  }

  private func refresh() {
    let trusted = SelectionReader.isTrusted
    guard trusted != isTrusted else { return }
    isTrusted = trusted
    updatePolling()
    onChange?(trusted)
  }

  private func updatePolling() {
    if isTrusted {
      poll?.invalidate()
      poll = nil
    } else if poll == nil {
      poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.refresh() }
      }
    }
  }
}
