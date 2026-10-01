import AICore
import Foundation
import Testing
import WebKit

@testable import AIRelay

/// The scheme handler end to end: a real WKWebView (no window) against ``StubService``.
@Suite("Relay HTTP integration")
@MainActor
struct RelayHTTPTests {
  private static let assets = """
    const s = async (url, options) => (await fetch(url, options)).status;
    const page = await fetch('/');
    const script = await fetch('/app.js');
    return [page.status, page.headers.get('content-security-policy'),
      script.headers.get('content-type'), await s('/missing.js'), await s('/a%2Fb.js'),
      await s('/', { method: 'POST' })];
    """

  private static let echo = """
    const r = await fetch('/v1/echo?x=1&y=%20');
    return [r.status, (await r.json()).target, r.headers.get('x-service-id'),
      r.headers.get('set-cookie'), r.headers.get('x-content-type-options')];
    """

  private static let post = """
    const ok = await fetch('/v1/echo', { method: 'POST', body: '{"text":"héllo","n":1}',
      headers: { 'content-type': 'application/json', 'x-ai-relay': '1' } });
    const bare = await fetch('/v1/echo', { method: 'POST', body: 'x' });
    return [ok.status, (await ok.json()).body, bare.status, (await bare.json()).error.code];
    """

  private static let denied = """
    const s = async (url, options) => (await fetch(url, options)).status;
    return [await s('/v1/admin/shutdown'), await s('/v1/admin/routes'), await s('/v1/nope'),
      await s('/v1/tasks/a%2Fb'), await s('/v1/tasks/..'), await s('/v1/echo', { method: 'HEAD' }),
      await s('/v1/tasks/t1')];
    """

  private static let chunks = """
    const reader = (await fetch('/v1/chunks')).body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
    return [bytes];
    """

  private static let abort = """
    const controller = new AbortController();
    const settled = fetch('/v1/hang', { signal: controller.signal })
      .then(() => 'answered', (error) => error.name);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    return [await settled];
    """

  @Test("Serves bundle files with an explicit type and the production CSP")
  func assets() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    let result = try await h.values(Self.assets)
    #expect(result[0] as? Int == 200)
    #expect(result[1] as? String == ContentSecurityPolicy.production)
    #expect(result[2] as? String == "text/javascript; charset=utf-8")
    #expect(result[3] as? Int == 404)
    #expect(result[4] as? Int == 403)
    #expect(result[5] as? Int == 405)
  }

  @Test("Relays allowed /v1 routes with the token and epoch, and nothing else")
  func relays() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }

    let echo = try await h.values(Self.echo)
    #expect(echo[0] as? Int == 200)
    #expect(echo[1] as? String == "/v1/echo?x=1&y=%20")
    #expect(echo[2] is NSNull)
    #expect(echo[3] is NSNull)
    #expect(echo[4] as? String == "nosniff")
    let forwarded = try #require(h.stub.hits.last)
    #expect(forwarded.headers["authorization"] == "Bearer \(h.stub.token)")
    #expect(forwarded.headers["x-relay-epoch"] == "3")
    #expect(forwarded.headers["origin"] == nil)
    #expect(forwarded.headers["cookie"] == nil)

    let post = try await h.values(Self.post)
    #expect(post[0] as? Int == 200)
    #expect(post[1] as? String == #"{"text":"héllo","n":1}"#)
    #expect(post[2] as? Int == 403)
    #expect(post[3] as? String == "forbidden")

    let before = h.stub.hits.count
    let denied = try await h.values(Self.denied).compactMap { $0 as? Int }
    #expect(denied == [403, 403, 403, 403, 403, 403, 200])
    #expect(h.stub.hits.count == before + 1)
  }

  @Test("Replays an epoch conflict once after refetching the manifest (R4)")
  func epochConflict() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    #expect(try await h.js("return (await fetch('/v1/echo')).status") as? Int == 200)
    h.stub.epoch = 4
    #expect(try await h.js("return (await fetch('/v1/echo')).status") as? Int == 200)
    let tail = h.stub.hits.suffix(3).map { "\($0.path) \($0.headers["x-relay-epoch"] ?? "-")" }
    #expect(tail == ["/v1/echo 3", "/v1/admin/routes -", "/v1/echo 4"])
    // A business 409 carries no x-relay-epoch-current and is delivered, not replayed.
    #expect(try await h.js("return (await fetch('/v1/conflict')).status") as? Int == 409)
    #expect(h.stub.hits.filter { $0.path == "/v1/conflict" }.count == 1)
  }

  @Test("Streams large bodies and stops cleanly when the page aborts")
  func streamsAndAborts() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    #expect(try await h.values(Self.chunks).first as? Int == 200_000)
    #expect(try await h.values(Self.abort).first as? String == "AbortError")
    #expect(await Task.until { h.handler.liveTaskCount == 0 })
  }

  @Test("Development: proxies Vite, runs the refresh preamble by hash, blocks other inline script")
  func devServer() async throws {
    let h = try await RelayHarness.started(devServer: true)
    defer { h.tearDown() }
    let script = """
      for (let i = 0; i < 300 && !window.__mainRan; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const s = async (url) => (await fetch(url)).status;
      return [window.__mainRan === true, window.__refreshHooked === true,
        window.__inlineRan === true, typeof window.$RefreshReg$,
        (await fetch('/')).headers.get('content-security-policy'),
        await s('/src/main.js?t=5&import'), await s('/src/main.js?raw'), await s('/@evil/x'),
        await s('/v1/echo')];
      """
    let result = try await h.values(script)
    #expect(result[0] as? Bool == true)
    #expect(result[1] as? Bool == true)
    #expect(result[2] as? Bool == false)
    #expect(result[3] as? String == "function")
    let port = try #require(h.link.latest.flatMap { try? $0.get() }?.baseURL.port)
    let origin = try #require(DevServerOrigin(URL(string: "http://127.0.0.1:\(port)")!))
    #expect(result[4] as? String == ContentSecurityPolicy.development(hmr: origin))
    #expect(result.dropFirst(5).compactMap { $0 as? Int } == [200, 403, 403, 200])
  }

  @Test("Refuses requests another origin's page sends to ai-app://renderer")
  func refusesForeignOrigin() async throws {
    let h = try await RelayHarness.started()
    defer { h.tearDown() }
    let other = ForeignPage()
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(h.handler, forURLScheme: RendererSchemeHandler.scheme)
    configuration.setURLSchemeHandler(other, forURLScheme: "ai-app-other")
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.load(URLRequest(url: URL(string: "ai-app-other://page/")!))
    #expect(await Task.until { view.url != nil && !view.isLoading })
    let before = h.stub.hits.count
    let script = """
      const target = 'ai-app://renderer/v1/echo';
      await fetch(target, { method: 'POST', mode: 'no-cors', body: 'x' }).catch(() => null);
      await fetch(target, { mode: 'no-cors' }).catch(() => null);
      await fetch(target).catch(() => null);
      return 'sent';
      """
    let sent = try await view.callAsyncJavaScript(script, contentWorld: .page)
    #expect(sent as? String == "sent")
    #expect(h.stub.hits.count == before)
  }
}

/// Serves a blank page on another custom scheme.
@MainActor
final class ForeignPage: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let body = Data("<html><body>other</body></html>".utf8)
    task.didReceive(
      HTTPURLResponse(
        url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "text/html"])!)
    task.didReceive(body)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
