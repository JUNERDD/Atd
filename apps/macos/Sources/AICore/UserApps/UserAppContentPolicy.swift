import Foundation

/// What a user app's page may load, enforced twice (T1 found either layer alone stops loopback,
/// https, images and `EventSource`; with neither, a POST to another app's origin reached the
/// handler with its body):
/// - ``contentSecurityPolicy``, the header of every HTML document the handler serves;
/// - ``ruleList(appId:)``, a `WKContentRuleList` compiled per app that blocks every load except
///   the app's own origin. It also keeps the page off the Vite dev server's `/@fs/`, the
///   service's port and other apps, whatever the CSP says.
///
/// Apps that need outside data get it through their backend. Cookies and WebSocket are not
/// available to them.
public enum UserAppContentPolicy {
  /// The page's whole policy: the handler's index.html carries no meta CSP of its own that could
  /// loosen it, and none would (CSPs only add restrictions).
  public static let contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    // React and Radix set inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].joined(separator: "; ")

  /// The rule list's store identifier. The version changes with the rules, so a list compiled by
  /// an older build is never reused for different rules.
  public static func ruleListIdentifier(appId: String) -> String {
    "ai-userapp.rules.v2.\(appId)"
  }

  /// The rules: block everything, then exempt the app's own origin and the `blob:` URLs its page
  /// creates (`URL.createObjectURL`, e.g. to show a picked image), which the block would
  /// otherwise catch although the CSP allows them (T6 probe). A blob URL names memory of the same
  /// document, never the network. `url-filter` is a regular expression; a valid app id contains
  /// no character special to it.
  public static func ruleList(appId: String) -> String {
    precondition(UserAppOrigin.isValidAppId(appId), "Not an app id: \(appId)")
    let own = "^\(UserAppOrigin.scheme)://\(appId)/"
    let blob = "^blob:\(UserAppOrigin.scheme)://\(appId)/"
    return """
      [{"trigger":{"url-filter":".*"},"action":{"type":"block"}},\
      {"trigger":{"url-filter":"\(own)"},"action":{"type":"ignore-previous-rules"}},\
      {"trigger":{"url-filter":"\(blob)"},"action":{"type":"ignore-previous-rules"}}]
      """
  }
}
