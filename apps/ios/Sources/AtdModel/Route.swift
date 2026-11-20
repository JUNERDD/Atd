import Foundation
import Observation

/// A place in the app that something outside it can open: a widget's link, a control, an App
/// Intent, the Lock Screen capture extension or a deep link typed into Safari.
///
/// Every route has one URL, `<scheme>://<host>[/<id>][?<item>=<value>]`, with the scheme from the
/// bundle's Info.plist (`AtdURLScheme`: `atd-dev` in Debug, `atd` in Release):
///
/// | Route | URL |
/// | --- | --- |
/// | `.commands` | `atd://commands` |
/// | `.command(id:)` | `atd://command/<id>` |
/// | `.ask(text:)` | `atd://ask`, `atd://ask?text=<text>` |
/// | `.camera(commandID:)` | `atd://camera`, `atd://camera?command=<id>` |
/// | `.lockedCapture` | `atd://captured` |
/// | `.miniApps` | `atd://apps` |
/// | `.miniApp(id:)` | `atd://app/<id>` |
/// | `.automations` | `atd://automations` |
/// | `.automation(id:)` | `atd://automation/<id>` |
/// | `.me` | `atd://me` |
/// | `.models` | `atd://models` |
///
/// Ids and query values are percent-encoded and may hold any character, `/` and `+` included.
/// Hosts are matched without regard to case. A URL with another scheme, a user, port or fragment,
/// an unknown host, a missing, empty or extra path segment, an unknown or repeated query item, or
/// a query on a route that takes none names no route. Empty text and an empty command id read as
/// absent, so `.ask(text: "")` comes back from its URL as `.ask(text: nil)`.
public enum AtdRoute: Codable, Hashable, Sendable {
  /// The 指令 tab.
  case commands
  /// A command's detail on the 指令 tab.
  case command(id: String)
  /// 问 Atd over the current tab, with `text` waiting in the field (never sent by itself).
  case ask(text: String?)
  /// The camera (拍了就办), starting in the command with this id when it has the camera placement.
  case camera(commandID: String?)
  /// The camera with the photos the Lock Screen capture extension took, after the person unlocked.
  case lockedCapture
  /// The 小应用 tab.
  case miniApps
  /// A mini app on the 小应用 tab.
  case miniApp(id: String)
  /// The 自动化 tab.
  case automations
  /// An automation on the 自动化 tab.
  case automation(id: String)
  /// The 我的 tab.
  case me
  /// The model connections under 我的.
  case models
}

extension AtdRoute {
  /// The URL scheme of the running bundle (Info.plist `AtdURLScheme`), or nil when it names none
  /// (unit tests, previews). The app and every extension carry the same scheme.
  public static func currentScheme(bundle: Bundle = .main) -> String? {
    guard let scheme = bundle.object(forInfoDictionaryKey: "AtdURLScheme") as? String,
      isValidScheme(scheme)
    else { return nil }
    return scheme
  }

  /// This route's URL in `scheme`, which must be a valid URL scheme such as `atd-dev`.
  public func url(scheme: String) -> URL {
    precondition(Self.isValidScheme(scheme), "\(scheme) is not a URL scheme")
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    switch self {
    case .command(let id), .miniApp(let id), .automation(let id):
      components.percentEncodedPath = "/" + Self.encoded(id)
    case .ask(let text?) where !text.isEmpty:
      components.percentEncodedQuery = "text=" + Self.encoded(text)
    case .camera(let commandID?) where !commandID.isEmpty:
      components.percentEncodedQuery = "command=" + Self.encoded(commandID)
    default:
      break
    }
    // A valid scheme, a fixed host and percent-encoded parts always form a URL.
    guard let url = components.url else { preconditionFailure("unbuildable route URL") }
    return url
  }

  /// The route `url` names, or nil when it names none. `scheme` defaults to the running bundle's;
  /// URLs in any other scheme are rejected.
  public init?(url: URL, scheme: String? = AtdRoute.currentScheme()) {
    guard let scheme, url.scheme?.lowercased() == scheme.lowercased(),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.user == nil, components.password == nil, components.port == nil,
      components.fragment == nil, let host = components.host?.lowercased()
    else { return nil }
    // "" → no segment, "/x" → ["x"], "/x/" → ["x", ""].
    let segments = components.percentEncodedPath
      .split(separator: "/", omittingEmptySubsequences: false).dropFirst()
    let query = components.queryItems ?? []
    guard Set(query.map(\.name)).count == query.count else { return nil }

    switch (host, segments.count) {
    case (_, 1):
      guard query.isEmpty, let make = Self.identified[host],
        let id = segments.first?.removingPercentEncoding, !id.isEmpty
      else { return nil }
      self = make(id)
    case ("ask", 0):
      guard let text = Self.value(of: "text", in: query) else { return nil }
      self = .ask(text: text)
    case ("camera", 0):
      guard let commandID = Self.value(of: "command", in: query) else { return nil }
      self = .camera(commandID: commandID)
    case (_, 0):
      guard query.isEmpty, let route = Self.plain[host] else { return nil }
      self = route
    default:
      return nil
    }
  }

  /// The routes that take neither an id nor a query, by host.
  private static let plain: [String: AtdRoute] = [
    "commands": .commands, "captured": .lockedCapture, "apps": .miniApps,
    "automations": .automations, "me": .me, "models": .models,
  ]

  /// The routes that name one item by id, by host.
  private static let identified: [String: @Sendable (String) -> AtdRoute] = [
    "command": { .command(id: $0) }, "app": { .miniApp(id: $0) },
    "automation": { .automation(id: $0) },
  ]

  private var host: String {
    switch self {
    case .commands: "commands"
    case .command: "command"
    case .ask: "ask"
    case .camera: "camera"
    case .lockedCapture: "captured"
    case .miniApps: "apps"
    case .miniApp: "app"
    case .automations: "automations"
    case .automation: "automation"
    case .me: "me"
    case .models: "models"
    }
  }

  /// The value of the one query item a route accepts: `.some(nil)` when the query is empty or the
  /// value is, nil when the query holds any other item.
  private static func value(of name: String, in query: [URLQueryItem]) -> String?? {
    guard query.allSatisfy({ $0.name == name }) else { return nil }
    guard let value = query.first?.value, !value.isEmpty else { return .some(nil) }
    return .some(value)
  }

  /// `text` with everything but unreserved characters percent-encoded, so it fits one path
  /// segment or one query value whatever it holds.
  private static func encoded(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
  }

  private static let unreserved = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

  /// RFC 3986: an ASCII letter, then ASCII letters, digits, `+`, `-` or `.`.
  private static func isValidScheme(_ scheme: String) -> Bool {
    let letters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    let rest = letters.union(CharacterSet(charactersIn: "0123456789+-."))
    guard let first = scheme.unicodeScalars.first, letters.contains(first) else { return false }
    return scheme.unicodeScalars.allSatisfy { rest.contains($0) }
  }
}

extension AtdRoute {
  /// This route's URL in the running bundle's scheme, or nil when its Info.plist names none.
  public func url(bundle: Bundle = .main) -> URL? {
    Self.currentScheme(bundle: bundle).map { url(scheme: $0) }
  }
}

/// Where routes wait to be shown. Whatever opens a route in the app's process (a URL handler, an
/// App Intent's `perform()`, a user activity) calls `open(_:)`, even before the first view exists:
/// the route waits until something takes it. The root view takes the routes it shows itself (the
/// tabs, Ask, the camera). For a detail (`.command(id:)`, `.miniApp(id:)`, `.automation(id:)`,
/// `.models`) it only selects the tab and leaves the route pending, and the tab's page takes it;
/// while the camera is open, camera routes are left to the camera.
///
/// Only the latest route matters: one opened before the previous was taken replaces it.
@MainActor @Observable
public final class RouteCenter {
  public static let shared = RouteCenter()

  /// The route nobody has taken yet.
  public private(set) var pending: AtdRoute?

  public init() {}

  public func open(_ route: AtdRoute) {
    pending = route
  }

  /// Opens the route `url` names in the running bundle's scheme; false when it names none.
  @discardableResult
  public func open(_ url: URL) -> Bool {
    guard let route = AtdRoute(url: url) else { return false }
    open(route)
    return true
  }

  /// Takes the pending route when `pick` makes something of it, and hands that out once; any
  /// other route stays pending. A page takes its detail with
  /// `take { if case .miniApp(let id) = $0 { id } else { nil } }`.
  public func take<Value>(_ pick: (AtdRoute) -> Value?) -> Value? {
    guard let route = pending, let value = pick(route) else { return nil }
    pending = nil
    return value
  }
}
