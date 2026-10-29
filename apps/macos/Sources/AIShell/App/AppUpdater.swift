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
/// Info.plist turns on hourly scheduled checks without asking. A newer version found that way
/// downloads in the background through ``UpdateUserDriver``, which reports its progress as
/// ``state`` and leaves it to install when the app quits; ``installNow()`` installs it at once
/// and relaunches. Info.plist also turns off Sparkle's own silent automatic downloads
/// (`SUAllowsAutomaticUpdates`), which report no progress and would bypass that driver.
///
/// Debug builds never update: they run against `pnpm dev`, and a release would replace them.
final class AppUpdater: NSObject {
  /// Where the update stands, as the panel shows it.
  var state: UpdateStateEvent { driver?.state ?? .idle(.init()) }
  /// Runs after ``state`` changes.
  var onChange: (() -> Void)?
  private var updater: SPUUpdater?
  private var driver: UpdateUserDriver?
  /// The feed last written to the log by ``feedURLString(for:)``.
  private var loggedFeed: String?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "updates")

  /// Starts the updater, which checks at once when the last check is older than its interval.
  /// An updater that cannot start, which only a configuration error causes, is logged and leaves
  /// the build without updates.
  func start() {
    #if !DEBUG
      let driver = UpdateUserDriver(
        standard: SPUStandardUserDriver(hostBundle: .main, delegate: self))
      driver.onChange = { [weak self] in self?.onChange?() }
      let updater = SPUUpdater(
        hostBundle: .main, applicationBundle: .main, userDriver: driver, delegate: self)
      do {
        try updater.start()
      } catch {
        Self.log.fault("updater failed to start: \(error.localizedDescription, privacy: .public)")
        return
      }
      self.driver = driver
      self.updater = updater
    #endif
  }

  /// Whether this build updates, and so offers Check for Updates.
  var isAvailable: Bool { updater != nil }

  /// A check the user asked for, with Sparkle's own progress and result windows. An update
  /// already downloading or ready moves into them. Does nothing in a build that never updates.
  func checkForUpdates() {
    guard let updater else { return }
    NSApp.activate()
    updater.checkForUpdates()
  }

  /// The running build as the settings window's About page shows it.
  func about() -> AppAboutResult {
    let info = Bundle.main.infoDictionary ?? [:]
    return AppAboutResult(
      version: info["CFBundleShortVersionString"] as? String ?? "",
      build: info["CFBundleVersion"] as? String ?? "", updates: isAvailable)
  }

  /// Installs the ready update and relaunches through `applicationShouldTerminate`, so the quit
  /// guard still asks about running tasks; after a cancelled quit it asks again.
  func installNow() {
    driver?.installNow()
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
}

extension AppUpdater: SPUStandardUserDriverDelegate {
  /// The app lives in the menu bar, so an update Sparkle has to show itself (one that cannot
  /// install silently) appears without taking focus from the app in front.
  var supportsGentleScheduledUpdateReminders: Bool { true }
}
