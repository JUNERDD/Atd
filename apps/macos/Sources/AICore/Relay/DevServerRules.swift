import Foundation

/// The Vite dev server a Debug shell proxies renderer files to. Only a loopback `http` origin is
/// accepted: the proxy carries no credential, but the dev server can read the developer's files.
public struct DevServerOrigin: Equatable, Sendable {
  public let host: String
  public let port: Int

  /// `http://127.0.0.1:5173`-style origins only: loopback host, explicit port, nothing else.
  public init?(_ url: URL) {
    guard url.scheme == "http", let host = url.host(percentEncoded: false),
      ["127.0.0.1", "localhost", "::1"].contains(host), let port = url.port, (1...65535) ~= port,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      ["", "/"].contains(url.path(percentEncoded: true))
    else { return nil }
    self.host = host
    self.port = port
  }

  private var authority: String { host.contains(":") ? "[\(host)]:\(port)" : "\(host):\(port)" }
  /// `http://host:port`, the base of proxied requests.
  public var httpOrigin: String { "http://\(authority)" }
  /// `ws://host:port`, the HMR socket the page opens itself (Vite `server.hmr`).
  public var webSocketOrigin: String { "ws://\(authority)" }
}

/// Which renderer requests the development proxy forwards to Vite. Paths have already passed
/// ``RelayPath/normalize(_:)``; this adds Vite's special prefixes and the query, which the
/// release handler ignores but Vite needs (spike S4). Everything else is refused: the dev server
/// has had file-disclosure bugs reachable through crafted queries (`?raw`, `?inline`, `?url`), so
/// the proxy exposes no more of it than the renderer uses.
public enum DevProxyRule {
  public enum Refusal: Error, Equatable, Sendable {
    /// A `/@…` prefix Vite does not use for module serving, or `/@fs/` without a path.
    case specialPrefix
    /// A query parameter outside ``allowedQueryKeys`` (``openInEditorQueryKeys`` for the inspector
    /// endpoint) or with an unexpected value.
    case query
  }

  /// Vite's module-serving prefixes: its client (`/@vite/client`, `/@vite/env`), files outside
  /// the root by absolute path (`/@fs/<abs path>`, still limited by Vite's `server.fs.allow`),
  /// bare module ids (`/@id/…`) and the React refresh runtime (`/@react-refresh`).
  public static let allowedSpecialPrefixes: Set<String> = ["@vite", "@fs", "@id", "@react-refresh"]

  /// `t`: HMR cache-busting timestamp. `v`: optimized-dependency version hash. `import`: marks an
  /// asset or CSS request made by a module import. `url` and `no-inline`: an asset the renderer
  /// imports as a URL (`?url&no-inline`, the brand marks), which Vite answers with the URL
  /// string, never the file's content; `url` passes only beside `import`. Vite strips only `url`
  /// from the URL it hands out, so the page then fetches the file itself as `?no-inline`: that
  /// flag alone only stops inlining and serves the file as the bare path would.
  public static let allowedQueryKeys: Set<String> = ["t", "v", "import", "url", "no-inline"]

  /// The component inspector's endpoint (`apps/desktop/plugins/component-inspector.ts`). Its
  /// middleware answers `ok` and launches the editor CLI without a shell, never serving file
  /// content, so it takes its own parameters instead of the module-serving ones above.
  public static let openInEditorSegment = "__open_in_editor"
  public static let openInEditorQueryKeys: Set<String> = ["file", "line", "col", "editor"]

  /// The raw query to forward (nil for none), or why the request is refused.
  public static func check(_ path: NormalizedPath, rawQuery: String?) -> Result<String?, Refusal> {
    if path.segments == [openInEditorSegment] { return checkOpenInEditor(rawQuery: rawQuery) }
    if let first = path.segments.first, first.hasPrefix("@") {
      guard allowedSpecialPrefixes.contains(first) else { return .failure(.specialPrefix) }
      if first == "@fs", path.segments.count < 2 { return .failure(.specialPrefix) }
      if first == "@react-refresh", path.segments.count != 1 { return .failure(.specialPrefix) }
    }
    guard let rawQuery, !rawQuery.isEmpty else { return .success(nil) }
    var flags: Set<Substring> = []
    for item in rawQuery.split(separator: "&", omittingEmptySubsequences: false) {
      guard isAllowed(parameter: item) else { return .failure(.query) }
      if !item.contains("=") { flags.insert(item) }
    }
    guard !flags.contains("url") || flags.contains("import") else { return .failure(.query) }
    return .success(rawQuery)
  }

  /// Each parameter at most once and with a value; `line` and `col` are decimal numbers.
  private static func checkOpenInEditor(rawQuery: String?) -> Result<String?, Refusal> {
    guard let rawQuery, !rawQuery.isEmpty else { return .failure(.query) }
    var seen: Set<String> = []
    for item in rawQuery.split(separator: "&", omittingEmptySubsequences: false) {
      let parts = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
      let key = String(parts[0])
      guard parts.count == 2, !parts[1].isEmpty, openInEditorQueryKeys.contains(key),
        seen.insert(key).inserted
      else { return .failure(.query) }
      if key == "line" || key == "col" {
        guard parts[1].count <= 10, parts[1].utf8.allSatisfy({ (0x30...0x39).contains($0) })
        else { return .failure(.query) }
      }
    }
    return .success(rawQuery)
  }

  private static func isAllowed(parameter: Substring) -> Bool {
    let parts = parameter.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
    let key = String(parts[0])
    let value = parts.count == 2 ? parts[1] : nil
    switch key {
    case "import", "url", "no-inline":
      return value == nil
    case "t":
      guard let value, (1...20).contains(value.count) else { return false }
      return value.utf8.allSatisfy { (0x30...0x39).contains($0) }
    case "v":
      guard let value, (1...64).contains(value.count) else { return false }
      return value.utf8.allSatisfy {
        (0x30...0x39).contains($0) || (0x41...0x5A).contains($0) || (0x61...0x7A).contains($0)
      }
    default:
      return false
    }
  }
}
