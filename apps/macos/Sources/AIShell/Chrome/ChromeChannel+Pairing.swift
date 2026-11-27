import AIChromeChannelKit
import AICore
import Foundation

/// A session before it is paired: its `hello` authenticates it with the secret of an earlier
/// pairing, or it may ask the person to pair (`pair.request`), which only the native confirmation
/// grants (D4).
extension ChromeChannel {
  func handleUnpaired(_ frame: ChromeInboundFrame, from session: ChromeSession) {
    switch frame {
    case .hello(let hello):
      if let secret = hello.secret, let store {
        guard let browserIdentity = session.browserIdentity else {
          return session.reject(
            code: ChromeChannelErrorCode.browserNotVerified,
            message: "This browser's code signature could not be verified.")
        }
        switch store.verify(hello.installationId, secret: secret, browserIdentity: browserIdentity)
        {
        case .valid:
          link(session, hello)
        case .browserMismatch:
          Self.log.error("Refused a Chrome pairing presented from a different browser identity.")
          session.reject(
            code: ChromeChannelErrorCode.browserMismatch,
            message: "This pairing belongs to a different browser.")
        case .invalid:
          if store.unreadable {
            // The pairings could not be read: an unpaired welcome would make the extension forget
            // a secret that may still be valid. It connects again later instead.
            session.reject(
              code: ChromeChannelErrorCode.pairingsUnavailable,
              message: "Atd cannot check the pairing.")
          } else {
            sendWelcome(session)
          }
        }
      } else if hello.secret != nil {
        session.reject(
          code: ChromeChannelErrorCode.pairingsUnavailable,
          message: "Atd cannot check the pairing.")
      } else {
        sendWelcome(session)
      }
    case .pairRequest(let code):
      Task { await requestPairing(session, code: code) }
    case .pairCancel:
      session.pairingCode = nil
    case .settingsOpen:
      environment.openComputerSettings()
    case .appOpen:
      environment.openTask(nil)
    case .diagBatch:
      // Silently ignore extension diagnostic batches while unpaired so no `.error` feedback loop
      // is triggered.
      break
    default:
      session.send(
        .error(ref: nil, code: ChromeChannelErrorCode.notPaired, message: "Connect to Atd first."))
    }
  }

  /// Asks the person whether the session's profile may connect. Refused without asking while
  /// this shell cannot run tasks (another Atd is the computer host, the service is unavailable),
  /// while another dialog is open, or during the cooldown after the person turned the profile
  /// down; a pairing request withdrawn (`pair.cancel`) or a connection that ended meanwhile is
  /// not paired even when the person allowed it.
  private func requestPairing(_ session: ChromeSession, code: String) async {
    guard let hello = session.hello, let browserIdentity = session.browserIdentity,
      session.phase == .unpaired, session.pairingCode == nil
    else { return }
    let hostState = environment.hostState()
    guard hostState == .ready, let store else {
      let reason = store == nil ? "unavailable" : hostState.rawValue
      return session.send(.pairState(.init(state: .error, code: code, reason: reason)))
    }
    session.pairingCode = code
    session.send(.pairState(.init(state: .pending, code: code)))
    let label = Self.label(of: hello, browser: session.browser)
    let outcome = await pairing.ask(
      label: Self.profileName(of: hello, browser: session.browser), browser: session.browser,
      developer: browserIdentity.developerLabel, code: code)
    let current = session.pairingCode == code && session.phase == .unpaired
    session.pairingCode = nil
    guard current else { return }
    switch outcome {
    case .allowed:
      // A new pairing starts without the sites an earlier pairing of the id allowed.
      await deleteSites(of: hello.installationId)
      guard session.phase == .unpaired else { return }
      do {
        let secret = try store.pair(
          hello.installationId, label: label, email: hello.profile.email,
          browser: session.browser, browserIdentity: browserIdentity)
        store.resolve()
        session.send(.pairState(.init(state: .paired, code: code, secret: secret, label: label)))
        logShell(
          .info, category: "chrome",
          "profile_paired profile=\(Self.profileHash(of: hello.installationId)) browser=\(session.browser)"
        )
        link(session, hello)
        await refreshSites()
      } catch {
        Self.log.error("A Chrome pairing could not be saved.")
        logShell(
          .error, category: "chrome",
          "profile_pair_save_failed profile=\(Self.profileHash(of: hello.installationId))")
        session.send(.pairState(.init(state: .error, code: code, reason: "failed")))
      }
    case .denied:
      logShell(
        .info, category: "chrome",
        "profile_pair_denied profile=\(Self.profileHash(of: hello.installationId))")
      session.send(.pairState(.init(state: .denied, code: code)))
    case .busy, .cooldown:
      session.send(
        .pairState(.init(state: .error, code: code, reason: outcome == .busy ? "busy" : "cooldown"))
      )
    }
  }

  /// Settings › Computer use › Atd for Chrome › Disconnect: the pairing and its site bindings go,
  /// and a connected extension learns it (`unpaired`) and may pair again.
  func disconnect(installationId: String) async {
    store?.remove(installationId)
    store?.resolve()
    if let session = session(of: installationId) {
      if let link = session.link { links.remove(link) }
      session.unpair()
      sendWelcome(session)
    }
    logShell(
      .info, category: "chrome",
      "profile_unpaired profile=\(Self.profileHash(of: installationId))")
    environment.onStateChange()
    await deleteSites(of: installationId)
  }

  private static let genericBrowserBrands: Set<String> = [
    "chrome", "google chrome", "chromium",
    "google chrome beta", "google chrome dev", "google chrome canary",
  ]

  /// How Settings and the pairing store name a profile: its account, else its own profile name,
  /// else the verified browser (`Aside`, `Google Chrome`, …).
  static func label(of hello: ChromeHello, browser: String) -> String {
    profileName(of: hello, browser: browser)
      ?? (browser.isEmpty ? "Chromium" : browser.clipped(toUTF16: 200))
  }

  /// The profile's own name for the pairing alert: its account email (never filtered), else a
  /// custom profile name; nil when `hello.profile.label` is empty, matches `browser`, or is a
  /// generic `navigator.userAgentData` engine brand (`Google Chrome`, `Chromium`, `Chrome`).
  static func profileName(of hello: ChromeHello, browser: String) -> String? {
    if let email = hello.profile.email?.trimmingCharacters(in: .whitespacesAndNewlines),
      !email.isEmpty
    {
      return email.clipped(toUTF16: 200)
    }
    let name = hello.profile.label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, !genericBrowserBrands.contains(name.lowercased()) else { return nil }
    let trimmedBrowser = browser.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedBrowser.isEmpty,
      trimmedBrowser.localizedCaseInsensitiveContains(name)
        || name.localizedCaseInsensitiveContains(trimmedBrowser)
    {
      return nil
    }
    return name.clipped(toUTF16: 200)
  }
}
