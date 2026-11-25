import AIChromeChannelKit
import Darwin
import Foundation

/// The host's half of the mutual check (D3): before it sends anything, its own `host.hello`
/// included, the process listening on the socket must run as this user and be the main
/// executable of the app bundle the host sits in, recognized by cdhash
/// (``ChromeCodeSignature/verifyPeer(_:cdhash:)``). Another process that took the socket path
/// therefore never learns the caller origin or receives a byte of Chrome's. The shell runs the
/// mirror check on the host (`ChromeHostPeer`).
nonisolated enum HostListenerCheck {
  /// Throws `EX_NOPERM` unless the listener on the connected `socket` passes, or when the app at
  /// `app` (``HostLocation/appBundle()``) has no signature to compare it with.
  static func verify(_ socket: Int32, app: URL) throws(HostFailure) {
    let path = app.path(percentEncoded: false)
    guard let expected = ChromeCodeSignature.cdhash(ofCodeAt: app) else {
      throw HostFailure(
        status: EX_NOPERM, message: "\(path) has no readable code signature to check Atd against")
    }
    if case .failure(let refusal) = ChromeCodeSignature.verifyPeer(socket, cdhash: expected) {
      throw HostFailure(
        status: EX_NOPERM, message: "the socket's listener is not \(path): \(refusal)")
    }
  }
}
