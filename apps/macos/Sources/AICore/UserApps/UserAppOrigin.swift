import Foundation

/// The origin of one generated app: `ai-userapp://<appId>`, served by the shell's user-app scheme
/// handler from the app's current version. Every app is an origin of its own, so WebKit keeps its
/// storage, and the shell its requests and bridge, apart from every other app and from the
/// renderer (`ai-app://renderer`), whose handler and bridge a user app's web view never has.
public enum UserAppOrigin {
  public static let scheme = UserAppBridgeContract.scheme

  /// `app-` and ten lowercase letters or digits, as the service generates it. Such an id is
  /// already a canonical lowercase URL host, so hosts are compared with it exactly.
  public static func isValidAppId(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count == 14, value.hasPrefix("app-") else { return false }
    return bytes.dropFirst(4).allSatisfy { byte in
      (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
        || (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte)
    }
  }

  /// The serialized origin WebKit sends in `Origin` for the app's own requests.
  public static func serialized(appId: String) -> String { "\(scheme)://\(appId)" }

  /// The app's page; `index.html` is served for the root path. A route (`/notes/42`, from a
  /// widget tap) travels in the fragment, so it never reaches the scheme handler, and changing
  /// it in an open window is a same-document navigation the page sees as `hashchange`.
  public static func pageURL(appId: String, route: String? = nil) -> URL {
    precondition(isValidAppId(appId), "Not an app id: \(appId)")
    var components = URLComponents()
    components.scheme = scheme
    // A valid id is a valid host.
    components.host = appId
    components.path = "/"
    if let route, route != "/" { components.fragment = route }
    return components.url!
  }

  /// Whether `url` lies on `ai-userapp://<appId>/`, with no user, password or port.
  public static func isOwn(_ url: URL?, appId: String) -> Bool {
    guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return false }
    return components.scheme?.lowercased() == scheme && components.percentEncodedHost == appId
      && components.port == nil && components.user == nil && components.password == nil
  }

  /// Subframes never navigate; the main frame stays on the app's own origin. Links elsewhere go
  /// to the browser after the user confirms, never into the app's window.
  public static func allowsNavigation(to url: URL?, targetIsMainFrame: Bool, appId: String)
    -> Bool
  {
    targetIsMainFrame && isOwn(url, appId: appId)
  }

  /// A script message is trusted only from the main frame of the app the window shows.
  /// `port` is `WKSecurityOrigin.port`, 0 when the origin has none.
  public static func isTrustedSender(
    scheme senderScheme: String, host: String, port: Int, isMainFrame: Bool, appId: String
  ) -> Bool {
    isMainFrame && senderScheme == scheme && host == appId && port == 0
  }
}
