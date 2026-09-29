import Foundation

/// The one origin the shell trusts: `ai-app://renderer`, served by the relay's scheme handler.
/// Plan decision R6 replaces `frame-ancestors` (which WebKit ignores for custom schemes) with
/// navigation lockdown, and the bridge accepts only this origin's main frame.
public enum RendererOrigin {
  public static let scheme = "ai-app"
  public static let host = "renderer"

  /// The page each window loads; the settings window adds its fragment.
  public static func pageURL(fragment: String? = nil) -> URL {
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.path = "/"
    components.fragment = fragment
    return components.url!
  }

  /// Subframes never navigate; the main frame stays on the renderer origin.
  public static func allowsNavigation(to url: URL?, targetIsMainFrame: Bool) -> Bool {
    targetIsMainFrame && isRenderer(url)
  }

  /// A script message is trusted only from the main frame of the renderer origin.
  /// `port` is `WKSecurityOrigin.port`, 0 when the origin has none.
  public static func isTrustedSender(
    scheme senderScheme: String, host senderHost: String, port: Int, isMainFrame: Bool
  ) -> Bool {
    isMainFrame && senderScheme == scheme && senderHost == host && port == 0
  }

  private static func isRenderer(_ url: URL?) -> Bool {
    guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return false }
    return components.scheme?.lowercased() == scheme && components.host == host
      && components.port == nil && components.user == nil && components.password == nil
  }
}

/// Links the page may hand to the system browser (`openLink`): http and https only, checked
/// again in the shell whatever the page validated.
public enum ExternalLink {
  public static func openable(_ value: String) -> URL? {
    guard let components = URLComponents(string: value),
      let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = components.host, !host.isEmpty, let url = components.url
    else { return nil }
    return url
  }
}
