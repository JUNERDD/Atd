import AICore
import Foundation
import WebKit

/// What the handler knows about the app a web view shows. The shell's window registry answers
/// it per web view, so the app id comes from which window asked, never from the page.
public struct UserAppSession: Sendable {
  public let appId: String
  /// The current version's `web/` directory.
  public let files: StaticFileResolver

  public init(appId: String, webRoot: URL) {
    self.appId = appId
    files = StaticFileResolver(root: webRoot)
  }
}

/// The `ai-userapp://<appId>/` handler of every user app's web view. It never serves the
/// renderer or reaches a `renderer` route: a user app's configuration registers only this
/// handler, and the only service routes it forwards to are the app's own `shell`-exposure
/// routes, with the token the shell adds.
///
/// Every request, in this order (the first refusal answers, in the service's error envelope):
/// 1. The web view must host an app (403); its id is the registry's.
/// 2. ``UserAppRequestGate``: `Origin` if present, the main document and the URL's host must all
///    be that app (403); the URL is normalized once (403); routing by method and path (404, 405);
///    a call needs `x-ai-relay: 1` (403), a body under 4 MiB (413) that is not a stream and not a
///    dropped `Blob` (400).
/// 3. Files come from the current version's `web/` (404 when missing), HTML with the app CSP.
///    Calls and the event stream go to `/v1/apps/:appId/api/:name` and `/v1/apps/:appId/events`.
///
/// Answers stream back as the service sends them. When WebKit stops a task (the page aborted or
/// went away), the responder goes quiet and the upstream request is cancelled, which ends the
/// backend call's stream on the service side.
public final class UserAppSchemeHandler: NSObject, WKURLSchemeHandler {
  public static let scheme = UserAppOrigin.scheme

  private let tasks = SchemeTaskTable()
  private let link: ServiceLink
  private let session: @MainActor (WKWebView) -> UserAppSession?

  public init(link: ServiceLink, session: @escaping @MainActor (WKWebView) -> UserAppSession?) {
    self.link = link
    self.session = session
  }

  /// Scheme tasks still being answered.
  public var liveTaskCount: Int { tasks.count }

  public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let responder = tasks.open(urlSchemeTask)
    let request = urlSchemeTask.request
    guard let app = session(webView), let url = request.url else {
      return responder.error(status: 403, "This window hosts no app.")
    }
    let checked = UserAppRequestGate.Request(
      method: request.httpMethod ?? "GET", url: url, headers: request.allHTTPHeaderFields ?? [:],
      mainDocumentURL: request.mainDocumentURL, body: request.httpBody,
      hasBodyStream: request.httpBodyStream != nil)
    switch UserAppRequestGate.check(checked, appId: app.appId) {
    case .failure(let refusal):
      responder.error(status: refusal.status, refusal.message)
    case .success(.asset(let path)):
      serve(path, from: app, to: responder)
    case .success(.call(let name, let query)):
      let path = "/v1/apps/\(app.appId)/api/\(RelayPath.encodeSegment(name))"
      forward(checked, path: path, query: query, to: responder)
    case .success(.events(let query)):
      forward(checked, path: "/v1/apps/\(app.appId)/events", query: query, to: responder)
    }
  }

  public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    tasks.stop(urlSchemeTask)
  }

  private func serve(
    _ path: NormalizedPath, from app: UserAppSession, to responder: SchemeResponder
  ) {
    guard let file = app.files.resolve(path),
      let body = try? Data(contentsOf: file, options: .mappedIfSafe)
    else { return responder.error(status: 404, "No such file in this app.") }
    let type = RendererMIMEType.forFile(named: file.lastPathComponent)
    var headers = [
      "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
    ]
    if RendererMIMEType.isHTML(type) {
      headers["Content-Security-Policy"] = UserAppContentPolicy.contentSecurityPolicy
    }
    responder.complete(status: 200, headers: headers, body: body)
  }

  private func forward(
    _ request: UserAppRequestGate.Request, path: String, query: String?,
    to responder: SchemeResponder
  ) {
    Task {
      guard case .success(let endpoint) = await link.endpoint() else {
        return responder.error(
          status: RelayPolicy.unavailableStatus, "The agent service is not available.")
      }
      guard responder.isLive else { return }
      guard let url = endpoint.url(encodedPath: path, query: query) else {
        return responder.error(status: RelayPolicy.deniedStatus, "The request URL is not valid.")
      }
      var upstream = URLRequest(url: url)
      upstream.httpMethod = request.method
      upstream.httpBody = request.method == "POST" ? (request.body ?? Data()) : nil
      upstream.allHTTPHeaderFields = RelayHeaders.forwardUserAppRequest(
        request.headers, token: endpoint.token)
      let exchange = UpstreamExchange(
        onResponse: { response in
          responder.respond(
            status: response.statusCode,
            headers: RelayHeaders.forwardResponse(response.stringHeaders))
          return .stream
        },
        onData: { responder.send($0) },
        onComplete: { error in
          if let error { responder.fail(error) } else { responder.finish() }
        })
      responder.onStop = { exchange.cancel() }
      exchange.start(upstream, session: Self.session(for: request))
    }
  }

  /// Streams wait on the backend for as long as it keeps them open; one-shot calls keep the
  /// relay's idle limit.
  private static func session(for request: UserAppRequestGate.Request) -> URLSession {
    let accept = request.headers.first {
      $0.key.caseInsensitiveCompare("Accept") == .orderedSame
    }?.value.lowercased()
    let streams =
      request.method == "GET" || accept?.contains("application/x-ndjson") == true
      || accept?.contains("text/event-stream") == true
    return streams ? RelaySession.streaming : RelaySession.shared
  }
}
