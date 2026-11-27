import AICore
import Foundation

/// Atd for Chrome's part of `computer.state` (K3): whether the native messaging host manifest is in
/// place, the extension ID this build admits, and every paired Chrome profile with whether it is
/// connected now.
enum ChromeChannelState {
  /// Before the channel starts, or in a build without an app bundle: nothing is installed or paired.
  static var unavailable: ComputerStateEvent.Chrome {
    ComputerStateEvent.Chrome(
      hostManifest: .failed, browsers: [],
      extensionIds: .init(expected: ChromeChannelIdentity.configured.extensionId), connections: [])
  }
}

extension ChromeChannel {
  var stateEvent: ComputerStateEvent.Chrome {
    let connections = (store?.pairings ?? [:]).sorted { $0.key < $1.key }.prefix(32).map {
      id, pairing in
      ComputerStateEvent.Chrome.Connection(
        installationId: id, label: pairing.label.clipped(toUTF16: 320),
        email: pairing.email.flatMap { $0.isEmpty ? nil : $0.clipped(toUTF16: 320) },
        browser: pairing.browser.isEmpty ? "Chromium" : pairing.browser.clipped(toUTF16: 120),
        connected: links.link(id) != nil,
        lastSeenAt: pairing.lastSeenAt, sites: sites(of: id).count)
    }
    return ComputerStateEvent.Chrome(
      hostManifest: hostManifest, browsers: installedBrowsers,
      extensionIds: .init(expected: identity.extensionId),
      connections: Array(connections))
  }
}
