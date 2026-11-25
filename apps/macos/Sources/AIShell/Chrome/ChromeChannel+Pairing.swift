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
        link(session, hello)
        await refreshSites()
      } catch {
        Self.log.error("A Chrome pairing could not be saved.")
        session.send(.pairState(.init(state: .error, code: code, reason: "failed")))
      }
    case .denied:
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
    environment.onStateChange()
    await deleteSites(of: installationId)
  }
}
