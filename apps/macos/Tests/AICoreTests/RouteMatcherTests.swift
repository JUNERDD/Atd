import Foundation
import Testing

@testable import AICore

@Suite("Route manifest and allow-list")
struct RouteMatcherTests {
  private static func route(_ method: String, _ pattern: String, _ exposure: RouteManifest.Exposure)
    -> RouteManifest.Route
  {
    RouteManifest.Route(method: method, pathPattern: pattern, exposure: exposure)
  }

  private static let manifest = RouteManifest(
    epoch: 7,
    routes: [
      route("GET", "/v1/tasks", .renderer),
      route("POST", "/v1/tasks", .renderer),
      route("GET", "/v1/tasks/:taskId", .renderer),
      route("POST", "/v1/tasks/preview", .renderer),
      route("PUT", "/v1/plugins/:id/items/:kind/:name/enabled", .renderer),
      route("GET", "/v1/:kind/routes", .renderer),
      route("GET", "/v1/admin/routes", .shell),
      route("POST", "/v1/admin/shutdown", .shell),
      route("POST", "/v1/capabilities/result", .shell),
      route("GET", "/v1/stream", .shell),
      route("GET", "/v1/mixed/:id", .shell),
      route("GET", "/v1/mixed/open", .renderer),
      route("GET", "/v1/:section/x/:id", .shell),
      route("GET", "/v1/lit/:a/:b", .renderer),
    ])

  private func decide(_ method: String, _ raw: String) throws -> RouteDecision {
    try RouteMatcher(manifest: Self.manifest).decide(method: method, path: RelayPath.normalize(raw))
  }

  @Test("Decodes the wire manifest and ignores unknown keys")
  func decodes() throws {
    let json = """
      {"epoch": 3, "extra": true, "routes": [
        {"method": "GET", "pathPattern": "/v1/tasks", "exposure": "renderer", "note": "x"},
        {"method": "POST", "pathPattern": "/v1/admin/shutdown", "exposure": "shell"}
      ]}
      """
    let manifest = try RouteManifest.decode(Data(json.utf8))
    #expect(manifest.epoch == 3)
    #expect(
      manifest.routes == [
        Self.route("GET", "/v1/tasks", .renderer), Self.route("POST", "/v1/admin/shutdown", .shell),
      ])
  }

  @Test(
    "Refuses a manifest with an unknown exposure, a fractional epoch or missing fields",
    arguments: [
      #"{"epoch":1,"routes":[{"method":"GET","pathPattern":"/v1/x","exposure":"public"}]}"#,
      #"{"epoch":1.5,"routes":[]}"#,
      #"{"routes":[]}"#,
      #"{"epoch":1,"routes":[{"method":"GET","exposure":"renderer"}]}"#,
      #"{"epoch":1,"routes":{}}"#,
    ])
  func refusesBadWire(json: String) {
    #expect(throws: (any Error).self) { try RouteManifest.decode(Data(json.utf8)) }
  }

  @Test(
    "Refuses the whole manifest for patterns outside the contract",
    arguments: [
      "/v1/files/*", "/v1/x/:id(^\\d+)", "/v1/x/:a-:b", "/v1/x/file.:ext", "v1/x", "/v1/x/::y",
      "/v1/x/:", "/v1/x/:id?", "/v1/x/*name",
    ])
  func refusesUnsupportedPatterns(pattern: String) {
    let manifest = RouteManifest(epoch: 1, routes: [Self.route("GET", pattern, .shell)])
    #expect(throws: RouteManifestError.unsupportedPattern(pattern)) {
      try RouteMatcher(manifest: manifest)
    }
  }

  @Test("Refuses a negative epoch and keeps a valid one")
  func epoch() throws {
    #expect(throws: RouteManifestError.negativeEpoch) {
      try RouteMatcher(manifest: RouteManifest(epoch: -1, routes: []))
    }
    #expect(try RouteMatcher(manifest: Self.manifest).epoch == 7)
  }

  @Test(
    "Allows renderer routes by method and path",
    arguments: [
      ("GET", "/v1/tasks"), ("POST", "/v1/tasks"), ("GET", "/v1/tasks/abc"),
      ("POST", "/v1/tasks/preview"), ("PUT", "/v1/plugins/p1/items/skill/my%20skill/enabled"),
      ("GET", "/v1/%74asks"), ("GET", "/v1/mixed/open"), ("GET", "/v1/other/routes"),
      ("GET", "/v1/lit/x/y"),
    ])
  func allows(method: String, raw: String) throws {
    #expect(try decide(method, raw) == .allow)
  }

  @Test(
    "Denies by default: unknown paths, other methods, extra or missing segments",
    arguments: [
      ("GET", "/"), ("GET", "/v1"), ("GET", "/v1/unknown"), ("DELETE", "/v1/tasks"),
      ("get", "/v1/tasks"), ("HEAD", "/v1/tasks"), ("GET", "/v1/tasks/a/b"),
      ("PUT", "/v1/plugins/p1/items/skill/a/b/enabled"),
      ("PUT", "/v1/plugins/p1/items/skill/enabled"),
      ("GET", "/V1/tasks"), ("GET", "/v1/Tasks"),
    ])
  func deniesUnmatched(method: String, raw: String) throws {
    #expect(try decide(method, raw) == .deny(.unmatched))
  }

  @Test(
    "Denies shell routes, including where a renderer pattern also matches",
    arguments: [
      ("GET", "/v1/admin/routes"), ("POST", "/v1/admin/shutdown"),
      ("POST", "/v1/capabilities/result"), ("GET", "/v1/stream"), ("GET", "/v1/mixed/abc"),
      ("GET", "/v1/any/x/1"),
    ])
  func deniesShell(method: String, raw: String) throws {
    #expect(try decide(method, raw) == .deny(.shellOnly))
  }

  @Test("A literal wins at the first differing segment, as the service router picks")
  func precedence() throws {
    let manifest = RouteManifest(
      epoch: 1,
      routes: [
        Self.route("GET", "/v1/:a/b", .shell),
        Self.route("GET", "/v1/x/:c", .renderer),
      ])
    let matcher = try RouteMatcher(manifest: manifest)
    #expect(matcher.decide(method: "GET", path: try RelayPath.normalize("/v1/x/b")) == .allow)
    #expect(
      matcher.decide(method: "GET", path: try RelayPath.normalize("/v1/y/b")) == .deny(.shellOnly))
  }

  @Test("Routes of another method do not take part in precedence")
  func precedenceIsPerMethod() throws {
    let manifest = RouteManifest(
      epoch: 1,
      routes: [
        Self.route("GET", "/v1/admin/routes", .shell),
        Self.route("POST", "/v1/:kind/routes", .renderer),
      ])
    let matcher = try RouteMatcher(manifest: manifest)
    #expect(
      matcher.decide(method: "POST", path: try RelayPath.normalize("/v1/admin/routes")) == .allow)
  }

  @Test("Two equally ranked routes of different exposure deny")
  func tieDenies() throws {
    let manifest = RouteManifest(
      epoch: 1,
      routes: [
        Self.route("GET", "/v1/a/:x", .renderer),
        Self.route("GET", "/v1/a/:y", .shell),
      ])
    let matcher = try RouteMatcher(manifest: manifest)
    #expect(
      matcher.decide(method: "GET", path: try RelayPath.normalize("/v1/a/1")) == .deny(.shellOnly))
  }

  @Test("A pattern with a trailing slash compiles and never matches")
  func trailingSlashPattern() throws {
    let manifest = RouteManifest(epoch: 1, routes: [Self.route("GET", "/v1/", .renderer)])
    let matcher = try RouteMatcher(manifest: manifest)
    #expect(
      matcher.decide(method: "GET", path: try RelayPath.normalize("/v1")) == .deny(.unmatched))
  }

  @Test("An empty manifest denies everything")
  func emptyManifest() throws {
    let matcher = try RouteMatcher(manifest: RouteManifest(epoch: 0, routes: []))
    #expect(
      matcher.decide(method: "GET", path: try RelayPath.normalize("/v1/tasks")) == .deny(.unmatched)
    )
  }
}
