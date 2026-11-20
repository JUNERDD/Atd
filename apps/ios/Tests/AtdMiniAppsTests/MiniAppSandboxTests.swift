import AtdModel
import Foundation
import Testing
import WebKit

@testable import AtdAppUI
@testable import AtdMiniApps

/// A page with one number field, kept in memory.
@MainActor
final class MemorySource: MiniAppPageSource {
  let manifest = MiniAppManifest(
    schema: MiniAppSchema(fields: [MiniAppField("count", .number, min: 0, max: 10)]),
    widget: .stat(.init(value: .field("count"), unit: nil, kicker: "Count", bars: nil)))
  var data: MiniAppData

  init() {
    data = MiniAppData(schema: manifest.schema, stored: [:])
  }

  var tint: CommandTint { .blue }

  func package() -> MiniAppPackage? {
    MiniAppPackage(manifest: manifest, page: "<p id=\"page\">Count</p>")
  }

  func snapshot() -> MiniAppJSON? {
    MiniAppSnapshot.json(manifest: manifest, data: data, ledger: nil)
  }

  func perform(_ request: MiniAppBridgeRequest) throws -> MiniAppJSON? {
    guard case .change(let operation) = request else { throw MiniAppInvalid("no ledger") }
    try data.apply(operation, schema: manifest.schema, context: MiniAppChangeContext(now: .now))
    return nil
  }
}

/// A real page in the real sandbox: what it can reach and what it cannot.
@MainActor @Suite(.serialized) struct MiniAppSandboxTests {
  private func started() async throws -> (MiniAppPageHost, MemorySource) {
    let source = MemorySource()
    let host = MiniAppPageHost(source: source, url: MiniAppSandbox.url(app: "sandbox-test"))
    await host.start()
    for _ in 0..<100 {
      if (try? await host.page.callJavaScript("return typeof window.atd")) as? String == "object" {
        return (host, source)
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    Issue.record("the page did not load")
    return (host, source)
  }

  private func run(_ host: MiniAppPageHost, _ body: String) async throws -> String? {
    try await host.page.callJavaScript(body) as? String
  }

  @Test func thePageChangesItsDataThroughAtdOnly() async throws {
    let (host, source) = try await started()
    defer { host.stop() }
    let reply = try await run(host, "return String(await atd.set('count', 5).then(d => d.count))")
    #expect(reply == "5" && source.data.number("count") == 5)
    let refused = try await run(
      host, "return await atd.set('count', 50).then(() => 'stored', e => 'refused')")
    #expect(refused == "refused" && source.data.number("count") == 5)
    // Another change from elsewhere reaches the page.
    try source.data.apply(
      .set(field: "count", value: 7), schema: source.manifest.schema,
      context: MiniAppChangeContext(now: .now))
    host.refresh()
    try await Task.sleep(for: .milliseconds(300))
    #expect(try await run(host, "return String(atd.data.count)") == "7")
  }

  @Test func theDocumentHasNoOriginOfItsOwn() async throws {
    let (host, _) = try await started()
    defer { host.stop() }
    #expect(try await run(host, "return String(window.origin)") == "null")
    let storage = try await run(
      host, "try { localStorage.setItem('k', 'v'); return 'stored' } catch (e) { return 'refused' }"
    )
    #expect(storage == "refused")
    let cookie = try await run(
      host, "try { document.cookie = 'k=v'; return document.cookie } catch (e) { return '' }")
    #expect(cookie == "")
  }

  @Test(arguments: [
    "return await fetch('https://example.com/').then(() => 'loaded', () => 'blocked')",
    """
    return await new Promise((done) => { const image = new Image(); image.onload = () => \
    done('loaded'); image.onerror = () => done('blocked'); image.src = \
    'https://example.com/a.png'; })
    """,
    """
    return await new Promise((done) => { try { const request = new XMLHttpRequest(); \
    request.onload = () => done('loaded'); request.onerror = () => done('blocked'); \
    request.open('GET', 'https://example.com/'); request.send() } catch (e) { done('blocked') } })
    """,
    """
    return await new Promise((done) => { try { const socket = new WebSocket('wss://example.com/'); \
    socket.onopen = () => done('loaded'); socket.onerror = () => done('blocked') } catch (e) { \
    done('blocked') } })
    """,
    "return await fetch('atd-mini://app/water/').then(() => 'loaded', () => 'blocked')",
  ])
  func thePageReachesNoNetworkAndNoOtherApp(_ probe: String) async throws {
    let (host, _) = try await started()
    defer { host.stop() }
    #expect(try await run(host, probe) == "blocked")
  }

  @Test func thePageCannotLeaveItsDocument() async throws {
    let (host, _) = try await started()
    defer { host.stop() }
    #expect(try await run(host, "return String(window.open('https://example.com/'))") == "null")
    _ = try await run(host, "location.href = 'https://example.com/'; return 'sent'")
    try await Task.sleep(for: .milliseconds(500))
    #expect(host.page.url == MiniAppSandbox.url(app: "sandbox-test"))
    #expect(try await run(host, "return typeof window.atd") == "object")
  }

  @Test func symbolsComeAsImages() async throws {
    let (host, _) = try await started()
    defer { host.stop() }
    let reply = try await run(
      host,
      "return await window.webkit.messageHandlers.atd.postMessage({op: 'symbols', names: ['drop']})"
    )
    let images = try #require(reply.flatMap(MiniAppJSON.parse))
    #expect(images["drop"]?.string?.hasPrefix("data:image/png;base64,") == true)
  }

  @Test func errorsInThePageAreReported() async throws {
    let (host, _) = try await started()
    defer { host.stop() }
    // A script of the page's own, so the error is not hidden as a script from elsewhere.
    _ = try await run(
      host,
      """
      const script = document.createElement('script');
      script.textContent = "setTimeout(() => { throw new Error('broken page') }, 0)";
      document.body.append(script);
      return 'ok'
      """)
    for _ in 0..<20 where host.error == nil {
      try await Task.sleep(for: .milliseconds(100))
    }
    #expect(host.error?.contains("broken page") == true, "\(host.error ?? "no error")")
  }
}
