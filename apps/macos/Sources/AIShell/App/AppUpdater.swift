import AICore
import AppKit
import OSLog
import Sparkle

/// Keeps a Release build current with Sparkle. The feed (`SUFeedURL`) is the architecture's
/// appcast (`appcast.xml` for arm64, `appcast-x64.xml` for x64) the R2 download mirror publishes
/// once it has verified the latest release's dmg; an x64 build under Rosetta reads the arm64 feed
/// instead (``feedURLString(for:)``). `release.yml` signs that dmg with the key `SUPublicEDKey`
/// names, and the EdDSA signature is what authorizes an update, since the self-signed release
/// certificate proves no identity.
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
  /// The feed last written to the log by ``feedURLString(for:)``.
  private var loggedFeed: String?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "updates")

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
  /// update shows as ready to install. Does nothing in a build that never updates.
  func checkForUpdates() {
    guard let controller else { return }
    NSApp.activate()
    controller.checkForUpdates(nil)
  }

  /// The running build as the settings window's About page shows it.
  func about() -> AppAboutResult {
    let info = Bundle.main.infoDictionary ?? [:]
    return AppAboutResult(
      version: info["CFBundleShortVersionString"] as? String ?? "",
      build: info["CFBundleVersion"] as? String ?? "", updates: isAvailable)
  }

  func installNow() {
    installHandler?()
  }
}

extension AppUpdater: SPUUpdaterDelegate {
  /// Routes an x64 build that runs under Rosetta to the arm64 feed, so an Apple silicon Mac that
  /// installed the Intel build returns to the native one on its next update. Every other case
  /// returns nil and keeps Sparkle's own order: a `SUFeedURL` user default (the documented test
  /// redirect, which also wins under Rosetta), then the build's Info.plist value.
  func feedURLString(for updater: SPUUpdater) -> String? {
    let routed = Self.isTranslated && UserDefaults.standard.string(forKey: "SUFeedURL") == nil
    let feed = routed ? Self.arm64FeedURL : nil
    // Sparkle asks before every check; log only changes, at a level that is kept on disk.
    let effective = feed ?? Self.defaultFeedURL ?? "none"
    if effective != loggedFeed {
      loggedFeed = effective
      Self.log.log(
        level: .default,
        "update feed \(effective, privacy: .public) (translated: \(Self.isTranslated, privacy: .public))"
      )
    }
    return feed
  }

  /// The arm64 feed. A user default lets a pre-release test point an x64 build at a local feed;
  /// otherwise the value every build carries in Info.plist. Nil when neither is set.
  private static var arm64FeedURL: String? {
    let key = "AtdArm64FeedURL"
    let value =
      UserDefaults.standard.string(forKey: key)
      ?? Bundle.main.object(forInfoDictionaryKey: key) as? String
    return value?.isEmpty == false ? value : nil
  }

  /// The feed Sparkle uses when the delegate returns nil, for the log only.
  private static var defaultFeedURL: String? {
    UserDefaults.standard.string(forKey: "SUFeedURL")
      ?? Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String
  }

  /// Whether this process is an x86_64 build translated by Rosetta. The key does not exist on
  /// Intel Macs, which reads as not translated.
  private static var isTranslated: Bool {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    return sysctlbyname("sysctl.proc_translated", &value, &size, nil, 0) == 0 && value == 1
  }

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
