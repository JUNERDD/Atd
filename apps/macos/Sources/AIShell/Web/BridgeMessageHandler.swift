import AICore
import Foundation
import OSLog
import WebKit

/// The page's end of the bridge: `window.webkit.messageHandlers.aiNative.postMessage(message)`.
/// Only the main frame of `ai-app://renderer` is heard, and only from the web view its host
/// currently shows; everything else is refused before any parsing. A message is decoded and
/// checked against the contract (``JsMessage``) and handed to the one dispatcher,
/// ``ShellBridge``. A call that fails the check is answered with an `error` for its id, so the
/// page's promise does not wait forever; anything else malformed is dropped and logged.
@MainActor
final class BridgeMessageHandler: NSObject, WKScriptMessageHandler {
  /// Set once the host exists; the content controller retains the handler, not the host.
  weak var host: WebViewHost?
  private let bridge: ShellBridge
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "bridge")

  init(bridge: ShellBridge) {
    self.bridge = bridge
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    let origin = message.frameInfo.securityOrigin
    guard
      RendererOrigin.isTrustedSender(
        scheme: origin.protocol, host: origin.host, port: origin.port,
        isMainFrame: message.frameInfo.isMainFrame),
      let host, message.webView === host.webView
    else { return Self.log.error("Refused a bridge message from an untrusted sender.") }
    guard JSONSerialization.isValidJSONObject(message.body),
      let data = try? JSONSerialization.data(withJSONObject: message.body)
    else { return Self.log.error("Dropped a bridge message that is not a JSON object.") }
    do {
      bridge.receive(try JSONDecoder().decode(JsMessage.self, from: data), from: host)
    } catch {
      let reason = Self.describe(error)
      Self.log.error("Refused a bridge message: \(reason, privacy: .public)")
      guard let call = try? JSONDecoder().decode(CallHead.self, from: data), call.type == "call"
      else { return }
      host.reply(
        .error(id: call.id, message: "The app refused \(call.method): \(reason)"),
        document: host.document)
    }
  }

  /// Enough of a refused call to answer it.
  private struct CallHead: Decodable {
    let type: String
    let id: Int
    let method: String
  }

  /// `params.url must match ^https?://.`: the member path and the broken rule.
  private static func describe(_ error: any Error) -> String {
    let path: [any CodingKey]
    let detail: String
    switch error as? DecodingError {
    case .dataCorrupted(let context), .typeMismatch(_, let context),
      .valueNotFound(_, let context):
      (path, detail) = (context.codingPath, context.debugDescription)
    case .keyNotFound(let key, let context):
      (path, detail) = (context.codingPath + [key], "is required.")
    default:
      return "invalid message."
    }
    let members = path.map(\.stringValue).filter { !$0.isEmpty }.joined(separator: ".")
    return String((members.isEmpty ? detail : "\(members): \(detail)").prefix(500))
  }
}
