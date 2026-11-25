import Foundation

/// Which Atd for Chrome flavor this build pairs with (D2): its native messaging host name and the
/// one extension ID the host manifest admits. The App target's Info.plist carries both per
/// configuration (`AtdChromeHostName`, `AtdChromeExtensionID`; Debug the `dev` flavor, Release the
/// `release` one), read here and checked against Chrome's own rules.
public struct ChromeChannelIdentity: Equatable, Sendable {
  public static let hostNameKey = "AtdChromeHostName"
  public static let extensionIdKey = "AtdChromeExtensionID"
  /// The flavor this configuration pairs with, for a build run outside its app bundle (tests,
  /// `swift run`), where no Info.plist names one; mirrors `apps/chrome-extension/flavors.ts`.
  public static let configured: ChromeChannelIdentity = {
    #if DEBUG
      ChromeChannelIdentity(
        checked: "com.junerdd.atd.chrome.dev", extensionId: "eolengaocpdgjapbjdfpfcokjpgjaedi")
    #else
      ChromeChannelIdentity(
        checked: "com.junerdd.atd.chrome", extensionId: "lcjihbdaipfphmofnhlocknjpnocbjbf")
    #endif
  }()

  /// Chrome's native messaging host name: dot-separated lowercase alphanumerics and `_`.
  public let hostName: String
  /// A Chrome extension ID: 32 letters `a` to `p`.
  public let extensionId: String

  public init?(hostName: String, extensionId: String) {
    guard Self.isHostName(hostName), Self.isExtensionId(extensionId) else { return nil }
    self.hostName = hostName
    self.extensionId = extensionId
  }

  /// The flavor constants above, which satisfy both rules.
  private init(checked hostName: String, extensionId: String) {
    self.hostName = hostName
    self.extensionId = extensionId
  }

  /// The identity an Info.plist dictionary names, or nil when either key is missing or invalid.
  public init?(info: [String: Any]?) {
    guard let hostName = info?[Self.hostNameKey] as? String,
      let extensionId = info?[Self.extensionIdKey] as? String
    else { return nil }
    self.init(hostName: hostName, extensionId: extensionId)
  }

  /// The caller origin Chrome passes the host for this extension (`allowed_origins`).
  public var origin: String { "chrome-extension://\(extensionId)/" }

  public static func isExtensionId(_ value: String) -> Bool {
    value.utf8.count == 32 && value.utf8.allSatisfy { (0x61...0x70).contains($0) }
  }

  public static func isHostName(_ value: String) -> Bool {
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    return !parts.isEmpty && value.utf8.count <= 255
      && parts.allSatisfy { part in
        !part.isEmpty
          && part.utf8.allSatisfy {
            (0x61...0x7a).contains($0) || (0x30...0x39).contains($0) || $0 == 0x5f
          }
      }
  }
}
