import AICore
import Foundation
import WebKit

/// The page's side of the bridge: `window.webkit.messageHandlers.aiShell.postMessage({ method,
/// params })` returns a promise of the reply. Only the main frame of `ai-app://renderer` is
/// heard, and only from the web view the host currently shows; everything else is refused
/// before any parsing.
@MainActor
final class BridgeMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
  static let name = "aiShell"

  /// Bridge plumbing the host serves itself, below any contract: the page is ready for
  /// events, and its drag rectangles changed.
  enum HostMethod: String {
    case ready = "shell.ready"
    case dragRegions = "shell.dragRegions"
  }

  /// Set once the host exists; the content controller retains the handler, not the host.
  weak var host: WebViewHost?
  private let router: any BridgeRouting

  init(router: any BridgeRouting) {
    self.router = router
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) async -> (Any?, String?) {
    let origin = message.frameInfo.securityOrigin
    guard
      RendererOrigin.isTrustedSender(
        scheme: origin.protocol, host: origin.host, port: origin.port,
        isMainFrame: message.frameInfo.isMainFrame),
      let host, message.webView === host.webView
    else { return (nil, "Untrusted bridge sender.") }
    guard let body = JSONValue(foundation: message.body), let method = body.string("method")
    else { return (nil, "A bridge call needs a method.") }
    let params = body["params"] ?? .null
    switch HostMethod(rawValue: method) {
    case .ready:
      host.pageDidBecomeReady()
      return (NSNull(), nil)
    case .dragRegions:
      host.setDragRegions(params)
      return (NSNull(), nil)
    case nil:
      do throws(BridgeError) {
        let reply = try await router.route(
          BridgeCall(method: method, params: params, role: host.role))
        return (reply.foundationObject, nil)
      } catch {
        return (nil, error.message)
      }
    }
  }
}

extension JSONValue {
  /// A value WebKit handed over (property-list types from `postMessage`); nil when it is not
  /// JSON (a Date, for example).
  init?(foundation value: Any) {
    guard JSONSerialization.isValidJSONObject([value]),
      let data = try? JSONSerialization.data(withJSONObject: [value]),
      let array = try? JSONDecoder().decode([JSONValue].self, from: data),
      let first = array.first
    else { return nil }
    self = first
  }

  /// The value as WebKit replies to `postMessage` (Foundation objects, `NSNull` for null).
  var foundationObject: Any {
    switch self {
    case .null: NSNull()
    case .bool(let value): value
    case .number(let value): value
    case .string(let value): value
    case .array(let values): values.map(\.foundationObject)
    case .object(let members): members.mapValues(\.foundationObject)
    }
  }

  /// Encodes an `Encodable` value into a JSON value.
  init(encoding value: some Encodable) throws {
    let data = try JSONEncoder().encode(value)
    self = try JSONDecoder().decode(JSONValue.self, from: data)
  }

  func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
  }
}
