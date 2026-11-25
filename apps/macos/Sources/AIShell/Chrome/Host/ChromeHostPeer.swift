import AIChromeChannelKit
import Darwin
import Foundation

/// The listener's peer check (D3): a socket peer is admitted only when it runs as this user and
/// is the native host binary this app embeds, recognized by its code signature rather than by a
/// path or a pid (``ChromeCodeSignature/verifyPeer(_:cdhash:)``). This keeps other local processes
/// off the channel; the pairing secret, checked later on the channel itself, is what makes a
/// Chrome profile trusted. The host runs the mirror check on this listener before it sends
/// anything (`HostListenerCheck` in AtdChromeHostCLI).
nonisolated enum ChromeHostPeer {
  /// The cdhash of the executable at `url` as it is on disk; nil when it is unsigned or its
  /// signature cannot be read.
  static func cdhash(ofExecutable url: URL) -> Data? {
    ChromeCodeSignature.cdhash(ofCodeAt: url)
  }

  /// The pid of the peer on the connected socket `descriptor` when it passes the check, else why
  /// it does not. `expected` is the embedded host binary's cdhash; without one every peer is
  /// refused.
  static func check(_ descriptor: Int32, expected: Data?) -> Result<pid_t, ChromeHostError> {
    guard let expected else {
      return .failure(
        ChromeHostError(description: "this build has no host binary to compare it with"))
    }
    return ChromeCodeSignature.verifyPeer(descriptor, cdhash: expected).mapError {
      ChromeHostError(description: $0.description)
    }
  }
}
