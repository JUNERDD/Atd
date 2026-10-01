import AICore
import Foundation
import WebKit

/// The `ai-app://renderer/` handler (plan P4, decisions Q6, Q7, R1, R4, R7). Register one
/// instance per `WKWebViewConfiguration` with
/// `configuration.setURLSchemeHandler(handler, forURLScheme: RendererSchemeHandler.scheme)`;
/// one handler may serve several web views.
///
/// Every request is checked in this order, and the first refusal answers:
/// 1. `Origin`, when present, must be `ai-app://renderer`, and so must the requesting main
///    document (403). WebKit sends no `Origin` on a cross-origin `no-cors` request to a custom
///    scheme, even a POST, but it always names the document that made it.
/// 2. The URL is normalized once (``RelayPath/classify(_:)``); anything ambiguous is 403.
/// 3. Renderer files take GET and HEAD only (405), then come from the bundle (404 when missing)
///    or, in development, from the Vite dev server (``DevProxyRule``, 403).
/// 4. `/v1` requests other than GET and HEAD need `x-ai-relay: 1` (403), then pass the route
///    manifest (403 when denied, 503 while it is unavailable) and are forwarded with the token.
///
/// Request bodies come from `httpBody` only. WebKit delivers `ArrayBuffer`, typed-array and
/// string bodies there; `Blob` bodies arrive empty and streams fail (spike S1), so the page's
/// host must not send those. A request that arrives with a body stream is refused (400).
@MainActor
public final class RendererSchemeHandler: NSObject, WKURLSchemeHandler {
  public static let scheme = RelayPath.scheme

  private let tasks = SchemeTaskTable()
  private let assets: RendererAssets
  private let api: APIRelay

  public init(renderer: RendererSource, link: ServiceLink) {
    assets = RendererAssets(source: renderer)
    api = APIRelay(link: link, manifests: RouteManifestCache())
  }

  init(renderer: RendererSource, link: ServiceLink, manifests: RouteManifestCache) {
    assets = RendererAssets(source: renderer)
    api = APIRelay(link: link, manifests: manifests)
  }

  /// Scheme tasks still being answered.
  public var liveTaskCount: Int { tasks.count }

  public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let responder = tasks.open(urlSchemeTask)
    let request = urlSchemeTask.request
    let method = request.httpMethod ?? "GET"
    let headers = request.allHTTPHeaderFields ?? [:]
    guard RelayRequestGate.checkOrigin(headers: headers) == nil,
      RelayRequestGate.checkDocument(request.mainDocumentURL) == nil
    else { return responder.error(status: 403, "Requests from other origins are refused.") }
    guard let url = request.url, let target = try? RelayPath.classify(url) else {
      return responder.error(status: 403, "The request URL is not allowed.")
    }
    switch target {
    case .asset(let path):
      guard RelayRequestGate.checkAsset(method: method) == nil else {
        return responder.error(status: 405, "Renderer files take GET and HEAD only.")
      }
      assets.serve(path: path, url: url, method: method, to: responder)
    case .api(let path, let query):
      guard RelayRequestGate.checkAPI(method: method, headers: headers) == nil else {
        return responder.error(status: 403, "State-changing requests need the relay header.")
      }
      guard request.httpBodyStream == nil else {
        return responder.error(status: 400, "Send request bodies as bytes or text, not streams.")
      }
      api.forward(
        RelayedRequest(
          method: method, path: path, query: query, headers: headers, body: request.httpBody),
        to: responder)
    }
  }

  public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    tasks.stop(urlSchemeTask)
  }
}
