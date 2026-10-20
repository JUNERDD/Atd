import AICore
import AIRelay
import AppKit
import OSLog

/// `computer.prepareBrowser` and `computer.openProfile` (D7, D16): the attended part of browser
/// targets. Preparing creates an empty managed profile, opens the start page in its own Chrome
/// window for the person to sign in, and registers the binding once they confirm; signing in
/// again reopens a binding's profile. Both bring Chrome forward: they are the person's own
/// requests in Settings, the only entries that do, since a run opens its website in the
/// background (``ManagedChromes/openInBackground(_:)``). A window a run parked beyond the displays
/// comes back on screen first. A preparation the person abandons removes its profile with
/// whatever it holds.
final class BrowserTargetPreparer {
  static let chromeDownload = URL(string: "https://www.google.com/chrome/")
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  private let chromes: ManagedChromes
  private let profiles: ManagedBrowserProfiles
  private let services: ShellServices
  private let confirmations: ConfirmationPrompter
  private let systemPanels: SystemPanels
  /// One preparation at a time.
  private var preparing = false

  init(
    chromes: ManagedChromes, profiles: ManagedBrowserProfiles, services: ShellServices,
    confirmations: ConfirmationPrompter, systemPanels: SystemPanels
  ) {
    self.chromes = chromes
    self.profiles = profiles
    self.services = services
    self.confirmations = confirmations
    self.systemPanels = systemPanels
  }

  func prepareBrowser(_ params: ComputerPrepareBrowserParams) async
    -> ComputerPrepareBrowserResult
  {
    typealias Result = ComputerPrepareBrowserResult
    if preparing || confirmations.isShowing || systemPanels.isOpen {
      return .notOk(.init(reason: .busy))
    }
    preparing = true
    defer { preparing = false }
    let origins = params.allowedOrigins.compactMap(BrowserOrigins.normalized(origin:))
    guard origins.count == params.allowedOrigins.count,
      BrowserOrigins.allows(params.startUrl, origins: origins),
      let urlPrefix = BrowserOrigins.pageRulePrefix(startUrl: params.startUrl)
    else {
      Self.log.error("A browser target's start page is not on its allowed sites.")
      return .notOk(.init(reason: .unavailable))
    }
    guard chromes.applicationURL != nil else {
      await offerChromeDownload()
      return .notOk(.init(reason: .unavailable))
    }
    let profile: (id: String, url: URL)
    let instance: ManagedChromeInstance
    do {
      profile = try profiles.create()
    } catch {
      Self.log.error("A browser profile could not be created: \(error, privacy: .public)")
      return .notOk(.init(reason: .unavailable))
    }
    do throws(ManagedChromeError) {
      instance = try await chromes.openAttended(profileId: profile.id, url: params.startUrl)
    } catch {
      Self.log.error("The managed browser did not open: \(error, privacy: .public)")
      profiles.remove(profile.id)
      return .notOk(.init(reason: .unavailable))
    }
    let abandon = { (reason: Result.NotOk.Reason) async -> Result in
      await self.chromes.quit(profile.id)
      self.profiles.remove(profile.id)
      return .notOk(.init(reason: reason))
    }
    switch await askSignedIn(label: params.label, browser: instance.pid) {
    case nil: return await abandon(.busy)
    case false?: return await abandon(.cancelled)
    case true?: break
    }
    do {
      let binding = try await services.client().saveComputerBinding(
        .init(
          content: .browser(
            label: params.label, profileId: profile.id, allowedOrigins: params.allowedOrigins,
            startUrl: params.startUrl, urlPrefix: urlPrefix)))
      return .ok(.init(bindingId: binding.bindingId, revision: binding.revision, probe: nil))
    } catch {
      Self.log.error("The browser target could not be registered: \(error, privacy: .public)")
      return await abandon(.unavailable)
    }
  }

  /// The person's own "Sign in again" / "Open browser": starts the binding's managed browser on
  /// its profile, or brings the one that runs forward, so the engine later attaches to this very
  /// browser (``ManagedChromes`` tracks it by profile). A run-only binding, which the service
  /// lists nowhere, is found among the openings the host refused
  /// (``ManagedChromes/refusedOpening(bindingId:)``).
  func openProfile(bindingId: String) async throws(BridgeError) {
    let refused = chromes.refusedOpening(bindingId: bindingId)
    let browser: TargetBindingWire.Browser
    if let refused {
      browser = refused
    } else {
      let binding: TargetBindingWire?
      do {
        binding = try await services.client().computerBindings().first {
          $0.bindingId == bindingId
        }
      } catch {
        throw BridgeError(ShellBridge.message(error, "The browser target could not be read."))
      }
      guard case .browser(let saved)? = binding else {
        throw BridgeError("This target has no browser profile.")
      }
      browser = saved
    }
    let profileId = browser.profileId
    let startUrl = browser.startUrl
    guard profiles.locate(profileId) != nil else {
      throw BridgeError(
        refused == nil
          ? "This browser profile is missing on this Mac; prepare the target again."
          : "This website's temporary browser profile is gone; ask for access to it again.")
    }
    guard chromes.applicationURL != nil else {
      await offerChromeDownload()
      throw BridgeError("Google Chrome is not installed.")
    }
    do throws(ManagedChromeError) {
      _ = try await chromes.openAttended(profileId: profileId, url: startUrl)
    } catch {
      throw BridgeError(error.errorDescription ?? "The browser profile could not be opened.")
    }
    chromes.forgetRefusedOpening(bindingId: bindingId)
  }

  /// Asks the person to sign in in the managed browser, then brings that browser in front of
  /// the dialog so they can. Nil when another confirmation is showing.
  private func askSignedIn(label: String, browser pid: pid_t) async -> Bool? {
    let strings = ShellStrings.shared
    let prompt = ConfirmationPrompt<Bool>(
      title: strings.text(.computerBrowserSignInTitle, label),
      message: strings.text(.computerBrowserSignInMessage, label),
      buttons: [
        .init(title: strings.text(.computerBrowserSignInDone), choice: true, isDefault: true),
        .init(title: strings.text(.cancel), choice: false, isCancel: true),
      ])
    let confirmations = confirmations
    let answer = Task { await confirmations.ask(prompt) }
    // The prompt activates Atd as it opens; the browser goes back in front once it shows.
    try? await Task.sleep(for: .milliseconds(400))
    NSRunningApplication(processIdentifier: pid)?.activate()
    return await answer.value
  }

  /// Explains that Chrome is required and offers its download page.
  private func offerChromeDownload() async {
    let strings = ShellStrings.shared
    let prompt = ConfirmationPrompt<Bool>(
      title: strings.text(.computerBrowserChromeMissingTitle),
      message: strings.text(.computerBrowserChromeMissingMessage),
      buttons: [
        .init(
          title: strings.text(.computerBrowserChromeMissingDownload), choice: true,
          isDefault: true),
        .init(title: strings.text(.cancel), choice: false, isCancel: true),
      ])
    guard await confirmations.ask(prompt) == true, let url = Self.chromeDownload else { return }
    NSWorkspace.shared.open(url)
  }
}
