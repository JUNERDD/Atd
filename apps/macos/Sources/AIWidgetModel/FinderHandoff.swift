import Foundation

/// How the Finder Sync extension (`AtdFinderSync`) hands the items selected in Finder to the
/// shell. The sandboxed extension cannot read those items, so LaunchServices refuses to have the
/// shell open them as `open -a` would. The extension writes their file URLs to the pasteboard
/// ``pasteboardName(hostBundleId:)`` names instead and opens ``url(scheme:)`` with the shell, which
/// takes the URLs from that pasteboard, releases it, and imports them like the Services entry.
///
/// The link itself carries nothing. Any app or page that knows the scheme can open it, and then
/// imports at most what is on that pasteboard, file URLs a local app could pass with `open -a`.
public enum FinderHandoff {
  public static let host = "finder"

  /// `<scheme>://finder`.
  public static func url(scheme: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    return components.url
  }

  /// True for exactly `<scheme>://finder`, with no path, query, fragment, credentials or port.
  public static func matches(_ url: URL, scheme: String) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return false
    }
    return components.scheme?.lowercased() == scheme && components.host == host
      && (components.path.isEmpty || components.path == "/") && components.query == nil
      && components.fragment == nil && components.user == nil && components.password == nil
      && components.port == nil
  }

  /// The pasteboard of one build's shell (Debug and Release differ, like their bundle ids).
  public static func pasteboardName(hostBundleId: String) -> String {
    "\(hostBundleId).finder-items"
  }
}
