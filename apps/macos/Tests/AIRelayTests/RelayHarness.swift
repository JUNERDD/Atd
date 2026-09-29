import AICore
import Foundation
import WebKit

@testable import AIRelay

/// A windowless WKWebView on `ai-app://renderer/` served from a temporary bundle, relaying to a
/// ``StubService`` whose endpoint files live in a temporary data directory. Nothing touches the
/// user's data directories, and every port is assigned by the OS.
@MainActor
final class RelayHarness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  static let pageScript = """
    window.__frames = [];
    window.__aiNativeBridge = { socketFrames(frames) { window.__frames.push(...frames); } };
    window.socket = (message) => window.webkit.messageHandlers.aiSocket.postMessage(message);
    window.framesOf = (id) => window.__frames.filter((f) => f.socketId === id);
    window.waitFor = async (predicate, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = predicate();
        if (value) return value;
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    """

  let stub: StubService
  let root: URL
  let dataDirectory: URL
  let link: ServiceLink
  let handler: RendererSchemeHandler
  let webView: WKWebView
  let pipe: VirtualSocketPipe
  private var loaded: CheckedContinuation<Void, Never>?

  /// - Parameter devServer: serve renderer files from the stub's dev-server mode instead of a
  ///   temporary bundle.
  init(stub: StubService, port: Int, devServer: Bool = false) throws {
    self.stub = stub
    root = FileManager.default.temporaryDirectory.appending(
      path: "relay-harness-\(UUID().uuidString)", directoryHint: .isDirectory)
    dataDirectory = root.appending(path: "data", directoryHint: .isDirectory)
    let bundle = root.appending(path: "renderer", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: dataDirectory.appending(path: "auth"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
    try Data(
      #"<!doctype html><html><head><script src="/app.js"></script></head><body>relay</body></html>"#
        .utf8
    ).write(to: bundle.appending(path: "index.html"))
    try Data(Self.pageScript.utf8).write(to: bundle.appending(path: "app.js"))

    link = ServiceLink(source: DevelopmentServiceSource(dataDirectory: dataDirectory))
    let renderer: RendererSource =
      devServer
      ? .devServer(DevServerOrigin(URL(string: "http://127.0.0.1:\(port)")!)!) : .bundle(bundle)
    handler = RendererSchemeHandler(renderer: renderer, link: link)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: RendererSchemeHandler.scheme)
    webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 400, height: 300), configuration: configuration)
    pipe = VirtualSocketPipe(webView: webView, link: link)
    super.init()
    try writeEndpoint(port: port, epoch: stub.epoch)
    configuration.userContentController.add(self, name: "aiSocket")
    webView.navigationDelegate = self
  }

  func writeEndpoint(port: Int, epoch: Int) throws {
    let endpoint: [String: Any] = [
      "version": 1, "serviceId": "stub-service", "protocolVersion": "1", "epoch": epoch,
      "host": "127.0.0.1", "port": port, "url": "http://127.0.0.1:\(port)",
      "pid": Int(getpid()), "startedAt": "2026-09-29T10:00:00.000Z",
    ]
    let token: [String: Any] = [
      "version": 1, "serviceId": "stub-service", "token": stub.token,
      "createdAt": "2026-09-29T10:00:00.000Z",
    ]
    try JSONSerialization.data(withJSONObject: endpoint).write(
      to: dataDirectory.appending(path: "endpoint.json"), options: .atomic)
    try JSONSerialization.data(withJSONObject: token).write(
      to: dataDirectory.appending(path: "auth/token"), options: .atomic)
  }

  func load() async {
    await withCheckedContinuation { continuation in
      loaded = continuation
      webView.load(URLRequest(url: URL(string: "ai-app://renderer/")!))
    }
  }

  /// Runs an async function body in the page and returns its result.
  func js(_ body: String) async throws -> Any? {
    try await webView.callAsyncJavaScript(body, contentWorld: .page)
  }

  /// Runs an async function body that returns an array.
  func values(_ body: String) async throws -> [Any] {
    try await js(body) as? [Any] ?? []
  }

  /// A harness on a fresh stub service, with its page loaded.
  static func started(devServer: Bool = false) async throws -> RelayHarness {
    let stub = try StubService()
    let port = try await stub.start()
    let harness = try RelayHarness(stub: stub, port: port, devServer: devServer)
    await harness.load()
    return harness
  }

  func tearDown() {
    pipe.invalidate()
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "aiSocket")
    stub.stop()
    try? FileManager.default.removeItem(at: root)
  }

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    let origin = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, origin.protocol == "ai-app", origin.host == "renderer",
      let command = VirtualSocketCommand(messageBody: message.body)
    else { return }
    pipe.receive(command)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?.resume()
    loaded = nil
  }
}

/// Records capability requests and answers them.
@MainActor
final class RecordingCapabilities: CapabilityHandling {
  var requests: [CapabilityRequest] = []

  func handle(_ request: CapabilityRequest) async throws -> JSONValue {
    requests.append(request)
    return .object(["text": .string("clipboard text")])
  }
}
