import Foundation

/// The site scope of a browser binding (D4): which origins its pages may show before the host
/// writes to them, which URLs `navigate` may open, and which page of the managed profile is the
/// target. Origins compare in a normalized form (`scheme://host[:port]`, lowercased, the default
/// port dropped), so `https://Example.com:443` and `https://example.com` are the same site.
public enum BrowserOrigins {
  /// The origin of an absolute http(s) URL, or nil for anything else, including URLs that carry
  /// credentials (`https://user@host`), which no binding may name.
  public static func origin(of url: String) -> String? {
    guard let components = URLComponents(string: url),
      let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
      components.user == nil, components.password == nil,
      let host = components.host?.lowercased(), !host.isEmpty
    else { return nil }
    let bracketed = host.contains(":") ? "[\(host)]" : host
    let defaultPort = scheme == "https" ? 443 : 80
    guard let port = components.port, port != defaultPort else {
      return "\(scheme)://\(bracketed)"
    }
    return "\(scheme)://\(bracketed):\(port)"
  }

  /// An allowed-origin entry in normalized form, or nil when it is not a bare origin (a path,
  /// query or fragment makes it something else).
  public static func normalized(origin entry: String) -> String? {
    guard let components = URLComponents(string: entry),
      components.path.isEmpty || components.path == "/", components.query == nil,
      components.fragment == nil
    else { return nil }
    return origin(of: entry)
  }

  /// Whether `url` is on one of `origins`.
  public static func allows(_ url: String, origins: [String]) -> Bool {
    guard let site = origin(of: url) else { return false }
    return origins.contains { normalized(origin: $0) == site }
  }

  /// Whether a page of the profile is the binding's target: its URL starts with the page rule's
  /// prefix and is on an allowed origin.
  public static func isTarget(url: String, urlPrefix: String, origins: [String]) -> Bool {
    url.hasPrefix(urlPrefix) && allows(url, origins: origins)
  }

  /// The page rule a newly prepared binding gets: any page on the start URL's origin, so a
  /// sign-in redirect or a later navigation inside the site keeps the page the target.
  public static func pageRulePrefix(startUrl: String) -> String? {
    origin(of: startUrl).map { $0 + "/" }
  }
}
