import AppKit
import Sparkle

/// Keeps a Release build current with Sparkle. The feed (`SUFeedURL`) is the `appcast.xml` the
/// R2 download mirror publishes once it has verified the latest release's dmg; `release.yml` signs
/// that dmg with the key `SUPublicEDKey` names, and the EdDSA signature is what authorizes an
/// update, since the self-signed release certificate proves no identity.
/// Info.plist turns on scheduled checks without asking and silent downloads, so a newer version
/// downloads in the background and installs when the app quits. Once one waits,
/// ``readyVersion`` names it and ``installNow()`` installs it and relaunches.
///
/// Debug builds never update: they run against `pnpm dev`, and a release would replace them.
final class AppUpdater: NSObject {
  /// The version of the downloaded update waiting to install, or nil.
  private(set) var readyVersion: String?
  /// Runs after ``readyVersion`` changes.
  var onChange: (() -> Void)?
  private var controller: SPUStandardUpdaterController?
  /// Sparkle's handler for the waiting update. It terminates the app through
  /// `applicationShouldTerminate`, so the quit guard still asks about running tasks, and it may
  /// run again after a quit was cancelled.
  private var installHandler: (() -> Void)?

  /// Starts the updater, which checks at once when the last check is older than its interval.
  func start() {
    #if !DEBUG
      controller = SPUStandardUpdaterController(
        startingUpdater: true, updaterDelegate: self, userDriverDelegate: self)
    #endif
  }

  /// Whether this build updates, and so offers Check for Updates.
  var isAvailable: Bool { controller != nil }

  /// A check the user asked for, with Sparkle's own progress and result windows. A waiting
  /// update shows as ready to install.
  func checkForUpdates() {
    NSApp.activate()
    controller?.checkForUpdates(nil)
  }

  func installNow() {
    installHandler?()
  }
}

extension AppUpdater: SPUUpdaterDelegate {
  /// A silently downloaded update is ready. Returning true keeps Sparkle from announcing it: the
  /// panel offers the restart instead, and a quit installs it either way.
  func updater(
    _ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
  ) -> Bool {
    installHandler = immediateInstallHandler
    readyVersion = item.displayVersionString
    onChange?()
    return true
  }
}

extension AppUpdater: SPUStandardUserDriverDelegate {
  /// The app lives in the menu bar, so an update Sparkle has to show itself (one that cannot
  /// install silently) appears without taking focus from the app in front.
  var supportsGentleScheduledUpdateReminders: Bool { true }
}
