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
