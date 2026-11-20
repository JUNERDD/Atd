import Foundation
import Testing

@testable import AtdModel

@Suite struct RouteTests {
  static let every: [AtdRoute] = [
    .commands, .command(id: "polish"), .ask(text: nil), .ask(text: "明天几点开会？"),
    .camera(commandID: nil), .camera(commandID: "expense"), .lockedCapture, .miniApps,
    .miniApp(id: "water"), .automations, .automation(id: "home"), .me, .models,
  ]

  @Test(arguments: every)
  func everyRouteComesBackFromItsURL(route: AtdRoute) {
    for scheme in ["atd", "atd-dev"] {
      #expect(AtdRoute(url: route.url(scheme: scheme), scheme: scheme) == route)
    }
  }

  @Test func urlsReadAsDocumented() {
    let expected: [(AtdRoute, String)] = [
      (.commands, "atd-dev://commands"),
      (.command(id: "polish"), "atd-dev://command/polish"),
      (.ask(text: nil), "atd-dev://ask"),
      (.ask(text: "hi there"), "atd-dev://ask?text=hi%20there"),
      (.camera(commandID: nil), "atd-dev://camera"),
      (.camera(commandID: "expense"), "atd-dev://camera?command=expense"),
      (.lockedCapture, "atd-dev://captured"),
      (.miniApps, "atd-dev://apps"),
      (.miniApp(id: "water"), "atd-dev://app/water"),
      (.automations, "atd-dev://automations"),
      (.automation(id: "home"), "atd-dev://automation/home"),
      (.me, "atd-dev://me"),
      (.models, "atd-dev://models"),
    ]
    for (route, url) in expected {
      #expect(route.url(scheme: "atd-dev").absoluteString == url)
    }
  }

  @Test(arguments: ["a/b", "a b", "50%", "a+b&c=d#e?f", "日程 🗓", "..", "~id_1-2.3"])
  func anyIDOrTextSurvivesItsURL(value: String) {
    let routes: [AtdRoute] = [
      .command(id: value), .miniApp(id: value), .automation(id: value), .ask(text: value),
      .camera(commandID: value),
    ]
    for route in routes {
      let url = route.url(scheme: "atd")
      #expect(AtdRoute(url: url, scheme: "atd") == route, "\(url)")
    }
  }

  @Test func emptyTextAndCommandReadAsAbsent() {
    let empty = AtdRoute.ask(text: "").url(scheme: "atd")
    #expect(AtdRoute(url: empty, scheme: "atd") == .ask(text: nil))
    #expect(route("atd://ask?text=", scheme: "atd") == .ask(text: nil))
    #expect(route("atd://camera?command=", scheme: "atd") == .camera(commandID: nil))
  }

  @Test func hostsAndSchemesIgnoreCase() {
    #expect(route("ATD-DEV://Commands", scheme: "atd-dev") == .commands)
    #expect(route("atd-dev://APP/Water", scheme: "atd-dev") == .miniApp(id: "Water"))
  }

  @Test(arguments: [
    "atd://commands",  // another scheme
    "https://atd.best/commands",
    "atd-dev:commands",  // no host
    "atd-dev://",
    "atd-dev://unknown",
    "atd-dev://commands/",  // extra segment
    "atd-dev://commands/polish",
    "atd-dev://command",  // missing id
    "atd-dev://command/",
    "atd-dev://command/a/b",
    "atd-dev://app/water?x=1",  // query on an id route
    "atd-dev://me?tab=1",
    "atd-dev://ask?question=hi",  // unknown item
    "atd-dev://ask?text=a&text=b",  // repeated item
    "atd-dev://ask?text=a&b",
    "atd-dev://camera?command=a&text=b",
    "atd-dev://ask#top",  // fragment
    "atd-dev://user@me",
    "atd-dev://me:80",
  ])
  func junkNamesNoRoute(url: String) throws {
    let url = try #require(URL(string: url))
    #expect(AtdRoute(url: url, scheme: "atd-dev") == nil)
  }

  @Test func withoutASchemeNothingParses() {
    #expect(AtdRoute(url: URL(string: "atd-dev://commands")!, scheme: nil) == nil)
    // The test bundle's Info.plist names no scheme.
    #expect(AtdRoute.currentScheme(bundle: Bundle(for: Marker.self)) == nil)
  }

  @Test func routesSurviveCoding() throws {
    let data = try JSONEncoder().encode(Self.every)
    #expect(try JSONDecoder().decode([AtdRoute].self, from: data) == Self.every)
  }

  @MainActor @Test func theCenterHandsOutTheLatestRouteOnce() {
    let center = RouteCenter()
    center.open(.me)
    #expect(center.open(URL(string: "atd-dev://nowhere")!) == false)
    center.open(.miniApps)
    #expect(center.pending == .miniApps)
    #expect(center.take { $0 } == .miniApps)
    #expect(center.take { $0 } == nil)
  }

  @MainActor @Test func aPageTakesOnlyItsOwnDetail() {
    let center = RouteCenter()
    let miniApp = { (route: AtdRoute) -> String? in
      if case .miniApp(let id) = route { id } else { nil }
    }
    center.open(.automation(id: "home"))
    #expect(center.take(miniApp) == nil)
    #expect(center.pending == .automation(id: "home"))
    center.open(.miniApp(id: "water"))
    #expect(center.take(miniApp) == "water")
    #expect(center.pending == nil)
  }

  /// The route a URL written out names in `scheme`.
  private func route(_ url: String, scheme: String) -> AtdRoute? {
    URL(string: url).flatMap { AtdRoute(url: $0, scheme: scheme) }
  }

  private final class Marker {}
}
