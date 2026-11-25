import Darwin
import Foundation
import Security

/// How the two ends of the native host channel (D3) recognize each other: by the code signature
/// of the process across the unix socket, never by a path or a pid. The shell admits a connecting
/// peer only when it is the host binary its bundle embeds (`ChromeHostPeer` in AIShell), and the
/// host talks only to a listener running its own app's main executable (`HostListenerCheck` in
/// AtdChromeHostCLI). Both compare cdhashes read here, so the file on disk and the process at the
/// other end of the socket are measured the same way on either side.
public nonisolated enum ChromeCodeSignature {
  /// Why a peer was refused. The text is for one log line and names the peer's pid once known.
  public struct Refusal: Error, Equatable, Sendable, CustomStringConvertible {
    public let description: String

    public init(_ description: String) { self.description = description }
  }

  /// The cdhash of the code at `url` as it is on disk: an executable, or a bundle, whose main
  /// executable then counts. Nil when the code is unsigned or its signature cannot be read.
  public static func cdhash(ofCodeAt url: URL) -> Data? {
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess, let code else {
      return nil
    }
    return cdhash(of: code)
  }

  /// The pid of the process at the other end of the connected unix socket `descriptor` when it
  /// runs as this user and its code is `expected` (a cdhash from ``cdhash(ofCodeAt:)``), else why
  /// not. Works from either end: on a connecting socket the peer is the listener.
  ///
  /// The peer is identified by the audit token the kernel recorded for the socket, so a pid that
  /// ended and was reused cannot stand in for it, and its running code must be valid and match
  /// its file (`SecCodeCheckValidity`) before that file's cdhash counts.
  public static func verifyPeer(
    _ descriptor: Int32, cdhash expected: Data
  ) -> Result<pid_t, Refusal> {
    var uid = uid_t()
    var gid = gid_t()
    guard getpeereid(descriptor, &uid, &gid) == 0 else { return refuse("its user is unknown") }
    guard uid == getuid() else { return refuse("it runs as user \(uid)") }
    var pid = pid_t()
    var pidLength = socklen_t(MemoryLayout<pid_t>.size)
    var token = audit_token_t()
    var tokenLength = socklen_t(MemoryLayout<audit_token_t>.size)
    guard getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &pidLength) == 0,
      getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &tokenLength) == 0
    else { return refuse("its process is unknown") }
    let attributes = [kSecGuestAttributeAudit: withUnsafeBytes(of: &token) { Data($0) }]
    var guest: SecCode?
    guard
      SecCodeCopyGuestWithAttributes(nil, attributes as CFDictionary, [], &guest) == errSecSuccess,
      let guest
    else { return refuse("pid \(pid) has no code identity") }
    guard SecCodeCheckValidity(guest, [], nil) == errSecSuccess else {
      return refuse("pid \(pid) is not validly signed")
    }
    var file: SecStaticCode?
    guard SecCodeCopyStaticCode(guest, [], &file) == errSecSuccess, let file,
      let actual = cdhash(of: file)
    else { return refuse("pid \(pid) has no readable signature") }
    guard actual == expected else { return refuse("pid \(pid) runs other code than expected") }
    return .success(pid)
  }

  /// `kSecCodeInfoUnique` of the code's signing information: the hash of its code directory.
  private static func cdhash(of code: SecStaticCode) -> Data? {
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(code, [], &information) == errSecSuccess,
      let information = information as? [String: Any]
    else { return nil }
    return information[kSecCodeInfoUnique as String] as? Data
  }

  private static func refuse(_ reason: String) -> Result<pid_t, Refusal> {
    .failure(Refusal(reason))
  }
}
