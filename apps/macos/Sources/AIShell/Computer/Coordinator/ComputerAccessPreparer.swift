import AICore
import AppKit

/// On-demand access uses the same app identities and managed browser profiles as Settings.
/// Resolution is read-only. Only the service's approved open operation launches a target, and it
/// never activates one.
final class ComputerAccessPreparer {
  /// How long after a launch an app that activates itself is still noticed.
  static let activationGrace: Duration = .milliseconds(300)

  private let profiles: ManagedBrowserProfiles
  private let chromes: ManagedChromes
  private var temporary: [String: Set<String>] = [:]

  init(profiles: ManagedBrowserProfiles, chromes: ManagedChromes) {
    self.profiles = profiles
    self.chromes = chromes
  }

  func resolve(_ target: ComputerAccessTargetWire) async throws(ComputerFailure)
    -> SaveComputerBindingRequestWire.Content
  {
    switch target {
    case .website(let url):
      guard let origin = BrowserOrigins.origin(of: url),
        let prefix = BrowserOrigins.pageRulePrefix(startUrl: url)
      else { throw ComputerFailure(.unsupported, "Use an http(s) URL without credentials.") }
      guard chromes.applicationURL != nil else {
        throw ComputerFailure(.targetUnavailable, "Google Chrome is not installed.")
      }
      return .browser(
        label: String((URL(string: url)?.host ?? origin).prefix(120)),
        profileId: ManagedChromeLaunch.newProfileId(), allowedOrigins: [origin],
        startUrl: url, urlPrefix: prefix)
    case .application(let name):
      let direct = NSWorkspace.shared.urlForApplication(withBundleIdentifier: name)
      let running = NSWorkspace.shared.runningApplications.compactMap(\.bundleURL)
      let matches = await NativeTargetProbe.detached {
        InstalledApplications.matching(name, direct: direct, running: running)
      }
      guard matches.count == 1, let identity = matches.first else {
        throw ComputerFailure(
          matches.isEmpty ? .targetUnavailable : .ambiguous,
          matches.isEmpty
            ? "No installed application matches \(name). Use its installed name or bundle id."
            : "Several installed applications match \(name). Ask which one the user means.")
      }
      guard identity.bundleId != "com.junerdd.ai",
        !identity.bundleId.hasPrefix("com.junerdd.ai.")
      else { throw ComputerFailure(.unsupported, "Atd cannot control its own conversation.") }
      return .native(
        label: String(identity.name.prefix(120)), bundleId: identity.bundleId,
        appName: identity.name, appPath: identity.path, teamId: identity.teamId)
    }
  }

  /// Opens the approved target for a run without bringing anything forward (plan §7, I2): an
  /// application that is not running launches without activation, and one that runs is left as
  /// it is, since reopening it could put a window over the person's; a website's start page opens
  /// as a background tab of its managed browser. Returns whether an app became active anyway (some
  /// activate themselves as they launch), which the reply reports: only another activation could
  /// undo it.
  func open(_ access: OpenComputerAccessWire, runId: String) async throws(ComputerFailure) -> Bool {
    switch access.binding {
    case .native(let native):
      return try await launch(native)
    case .browser(let browser):
      do {
        if profiles.locate(browser.profileId) == nil {
          _ = try profiles.create(id: browser.profileId)
        }
      } catch {
        throw ComputerFailure(
          .targetUnavailable,
          "The approved website's browser profile could not be made: \(error.localizedDescription)")
      }
      if !access.persistent { temporary[runId, default: []].insert(browser.profileId) }
      do throws(ComputerFailure) {
        return try await chromes.openInBackground(browser)
      } catch {
        // A browser that cannot start in the background is the person's to open
        // (`computer.openProfile`); the run's profile stays for that and for the next request,
        // and goes with the run.
        if !access.persistent, error.reason != .openBrowser { await finish(runId: runId) }
        throw error
      }
    }
  }

  /// Launches the approved application in the background unless it runs already, after checking
  /// it is still the app that was approved.
  private func launch(_ native: TargetBindingWire.Native) async throws(ComputerFailure) -> Bool {
    let identity = await NativeTargetProbe.detached {
      NativeAppIdentity.read(path: native.appPath)
    }
    guard let identity, identity.bundleId == native.bundleId, identity.teamId == native.teamId
    else {
      throw ComputerFailure(.targetUnavailable, "The approved application's identity changed.")
    }
    guard NSRunningApplication.runningApplications(withBundleIdentifier: identity.bundleId).isEmpty
    else { return false }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    configuration.addsToRecentItems = false
    let launched: NSRunningApplication
    do {
      launched = try await NSWorkspace.shared.openApplication(
        at: URL(filePath: identity.path), configuration: configuration)
    } catch {
      throw ComputerFailure(
        .targetUnavailable,
        "The approved application could not open: \(error.localizedDescription)")
    }
    // An app may activate itself a moment after it launched.
    try? await Task.sleep(for: Self.activationGrace)
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
      == launched.processIdentifier
  }

  /// Temporary browser data ends with its manual run; saved profiles remain for later tasks.
  func finish(runId: String) async {
    let ids = temporary.removeValue(forKey: runId) ?? []
    for id in ids {
      await chromes.quit(id)
      profiles.remove(id)
    }
  }

  func finishAll() async {
    for runId in Array(temporary.keys) { await finish(runId: runId) }
  }
}
