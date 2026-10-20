import AICore
import Foundation
import WebKit

/// The `ai-view://view/<taskId>/<callId>` handler of the renderer's web views: the documents of
/// generative views, a view's widget (`…/<callId>/widget`), which the panel frames in its
/// transcript, and its window document, which the view's own window frames. A user app's web view
/// never registers it.
///
/// Every request, in this order (the first refusal answers, in the service's error envelope):
/// 1. ``ViewRequestGate``: the renderer page must be the main document and `Origin`, if present,
///    the renderer's (403); GET and HEAD only (405); the URL must name a view document (404).
/// 2. The document comes from the service's shell-only `GET /v1/tasks/:taskId/views/:callId`
///    (`…/widget` for a widget, ``ViewDocument/servicePath``) with the token, in a request built
///    from scratch: nothing of the page's request travels on. No service is 503. The service's
///    status passes through; a document is answered with ``ViewOrigin/documentHeaders``, anything
///    else with the relay's headers for API data.
///
/// When WebKit stops a task (the frame went away), the responder goes quiet and the upstream
/// request is cancelled.
public final class ViewSchemeHandler: NSObject, WKURLSchemeHandler {
  public static let scheme = ViewOrigin.scheme

  private let tasks = SchemeTaskTable()
  private let link: ServiceLink

  public init(link: ServiceLink) {
    self.link = link
  }

  /// Scheme tasks still being answered.
  public var liveTaskCount: Int { tasks.count }

  public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let responder = tasks.open(urlSchemeTask)
    let request = urlSchemeTask.request
    let method = request.httpMethod ?? "GET"
    let checked = ViewRequestGate.check(
      method: method, url: request.url, headers: request.allHTTPHeaderFields ?? [:],
      mainDocumentURL: request.mainDocumentURL)
    switch checked {
    case .failure(let refusal):
      responder.error(status: refusal.status, refusal.message)
    case .success(let view):
      fetch(view, headOnly: method == "HEAD", to: responder)
    }
  }

  public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    tasks.stop(urlSchemeTask)
  }

  /// Always a GET upstream: the service exposes no HEAD routes, so a HEAD answer is the GET's
  /// head without its body.
  private func fetch(_ view: ViewDocument, headOnly: Bool, to responder: SchemeResponder) {
    Task {
      guard case .success(let endpoint) = await link.endpoint() else {
        return responder.error(
          status: RelayPolicy.unavailableStatus, "The agent service is not available.")
      }
      guard responder.isLive else { return }
      guard let url = endpoint.url(encodedPath: view.servicePath) else {
        return responder.error(status: RelayPolicy.deniedStatus, "The request URL is not valid.")
      }
      var upstream = URLRequest(url: url)
      upstream.httpMethod = "GET"
      upstream.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
      let exchange = UpstreamExchange(
        onResponse: { response in
          responder.respond(status: response.statusCode, headers: Self.headers(for: response))
          return .stream
        },
        onData: { if !headOnly { responder.send($0) } },
        onComplete: { error in
          if let error { responder.fail(error) } else { responder.finish() }
        })
      responder.onStop = { exchange.cancel() }
      exchange.start(upstream)
    }
  }

  /// A document gets the view's own headers. An error (404 for an unknown or invalid call) keeps
  /// the service's JSON with the relay's API headers, which sandbox it if a frame shows it, and is
  /// never labelled HTML.
  private static func headers(for response: HTTPURLResponse) -> [String: String] {
    guard (200..<300).contains(response.statusCode) else {
      return RelayHeaders.forwardResponse(response.stringHeaders)
    }
    return ViewOrigin.documentHeaders
  }
}
