import AICore
import Foundation

/// The two URLs a widget opens, where the scheme is `atd` (Release) or `atd-dev` (Debug), carried
/// in both Info.plists as ``schemeKey``:
/// - `<scheme>://apps/<appId>?route=<route>` opens an app's window at one of its routes; without
///   `route` (the launcher's tiles) it brings the app forward as it is, or opens it at its start;
/// - `<scheme>://panel` shows Atd's task panel (every widget state without app content).
/// Anything else, including other hosts, extra paths or query items, a fragment, credentials or
/// a port, is refused at the shell boundary: the URL is reachable by any app or web page that
/// knows the scheme, so it may only ever ask for one of those two things.
public enum WidgetLink {
  public static let schemeKey = "AtdURLScheme"
  public static let host = "apps"
  public static let panelHost = "panel"
  public static let maxRouteLength = 512

  /// The scheme of this bundle, from its Info.plist; nil outside an app.
  public static var mainBundleScheme: String? {
    Bundle.main.object(forInfoDictionaryKey: schemeKey) as? String
  }

  /// An app route as `WidgetRouteSchema` states it: `/` then no whitespace, at most 512 bytes.
  public static func isValidRoute(_ route: String) -> Bool {
    route.hasPrefix("/") && route.utf8.count <= maxRouteLength
      && !route.unicodeScalars.contains { CharacterSet.whitespacesAndNewlines.contains($0) }
  }

  public static func url(scheme: String, appId: String, route: String?) -> URL? {
    guard UserAppOrigin.isValidAppId(appId) else { return nil }
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.path = "/\(appId)"
    if let route {
      guard isValidRoute(route) else { return nil }
      components.queryItems = [URLQueryItem(name: "route", value: route)]
    }
    return components.url
  }

  /// `<scheme>://panel`.
  public static func panelURL(scheme: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = panelHost
    return components.url
  }

  public enum Target: Equatable, Sendable {
    /// `route` is nil when the link names none: an open window then keeps its page.
    case app(appId: String, route: String?)
    case panel
  }

  public static func parse(_ url: URL, scheme: String) -> Target? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.scheme?.lowercased() == scheme, components.user == nil,
      components.password == nil, components.port == nil, components.fragment == nil
    else { return nil }
    if components.host == panelHost {
      let bare = (components.path.isEmpty || components.path == "/") && components.query == nil
      return bare ? .panel : nil
    }
    guard components.host == host else { return nil }
    let segments = components.path.split(separator: "/", omittingEmptySubsequences: false)
    guard segments.count == 2, segments[0].isEmpty else { return nil }
    let appId = String(segments[1])
    guard UserAppOrigin.isValidAppId(appId) else { return nil }
    let items = components.queryItems ?? []
    guard items.count <= 1 else { return nil }
    guard let item = items.first else { return .app(appId: appId, route: nil) }
    guard item.name == "route", let route = item.value, isValidRoute(route) else { return nil }
    return .app(appId: appId, route: route)
  }
}

/// WidgetKit names the widget kinds the extension declares; the shell reloads them by these
/// names and reports the instances of `app`, the only kind the service renders for.
public enum WidgetKinds {
  /// "App Widget": each instance shows one widget a user app declares.
  public static let app = "AtdAppWidget"
  /// "My Apps": a launcher of the user's apps, which needs no renders, only the shell's files.
  public static let launcher = "AtdLauncherWidget"
}

/// What a widget instance shows: the id of the configuration's entity, `<appId>/<widgetId>`.
/// The shell reads it back from WidgetKit and reports it, so it is checked like any input.
public struct WidgetSelection: Equatable, Sendable {
  public let appId: String
  public let widgetId: String

  public init?(id: String) {
    let parts = id.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, UserAppOrigin.isValidAppId(String(parts[0])),
      Self.isValidWidgetId(String(parts[1]))
    else { return nil }
    appId = String(parts[0])
    widgetId = String(parts[1])
  }

  public init(appId: String, widgetId: String) {
    self.appId = appId
    self.widgetId = widgetId
  }

  public var id: String { "\(appId)/\(widgetId)" }

  /// `WidgetIdSchema`: a lowercase letter, then up to 31 lowercase letters, digits or `-`.
  public static func isValidWidgetId(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard let first = bytes.first, (1...32).contains(bytes.count),
      (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(first)
    else { return false }
    return bytes.allSatisfy { byte in
      (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte)
        || (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) || byte == UInt8(ascii: "-")
    }
  }
}
