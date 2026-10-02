import AICore
import Foundation

/// A `/v1` request of the page, after normalization and the request gate.
struct RelayedRequest {
  let method: String
  let path: NormalizedPath
  let query: String?
  let headers: [String: String]
  let body: Data?
}

/// Forwards allowed `/v1` requests to the service with the main token (decisions Q6, Q7, R1,
/// R4). The upstream request is built from scratch: allow-listed headers, the credential, the
/// manifest epoch, the canonical path and the raw query. The response head and body stream back
/// through the scheme task as they arrive.
final class APIRelay {
  private let link: ServiceLink
  private let manifests: RouteManifestCache

  init(link: ServiceLink, manifests: RouteManifestCache) {
    self.link = link
    self.manifests = manifests
  }

  func forward(_ request: RelayedRequest, to responder: SchemeResponder) {
    Task { await attempt(request, responder: responder, replayed: false) }
  }

  private func attempt(_ request: RelayedRequest, responder: SchemeResponder, replayed: Bool)
    async
  {
    guard responder.isLive else { return }
    guard case .success(let endpoint) = await link.endpoint() else {
      return responder.error(
        status: RelayPolicy.unavailableStatus, "The agent service is not available.")
    }
    guard let matcher = await manifests.matcher(for: endpoint) else {
      return responder.error(
        status: RelayPolicy.unavailableStatus, "The agent service's routes are not available yet.")
    }
    guard responder.isLive else { return }
    guard matcher.decide(method: request.method, path: request.path) == .allow else {
      return responder.error(
        status: RelayPolicy.deniedStatus, "The renderer may not call this route.")
    }
    guard let url = endpoint.url(encodedPath: request.path.encoded, query: request.query) else {
      return responder.error(status: RelayPolicy.deniedStatus, "The request URL is not valid.")
    }
    var upstream = URLRequest(url: url)
    upstream.httpMethod = request.method
    upstream.httpBody = request.body
    upstream.allHTTPHeaderFields = RelayHeaders.forwardRequest(
      request.headers, token: endpoint.token, epoch: matcher.epoch)
    #if DEBUG
      // Runtime verification: what the relay forwarded, and under which manifest epoch.
      RelayLog.relay.info(
        "forward \(request.method, privacy: .public) \(request.path.encoded, privacy: .public) epoch \(matcher.epoch)"
      )
    #endif

    let exchange = UpstreamExchange(
      onResponse: { response in
        let headers = response.stringHeaders
        let followUp = RelayPolicy.followUp(
          status: response.statusCode, headers: headers, replayed: replayed)
        if followUp == .refetchManifestAndReplay {
          self.replay(request, responder: responder)
          return .discard
        }
        responder.respond(
          status: response.statusCode, headers: RelayHeaders.forwardResponse(headers))
        return .stream
      },
      onData: { responder.send($0) },
      onComplete: { error in
        if let error { responder.fail(error) } else { responder.finish() }
      })
    responder.onStop = { exchange.cancel() }
    exchange.start(upstream)
  }

  /// An epoch conflict: the service restarted under the manifest. Refetch and send once more;
  /// the new manifest decides again, since the route's exposure may have changed with the code.
  private func replay(_ request: RelayedRequest, responder: SchemeResponder) {
    RelayLog.relay.info("Epoch conflict; refetching the route manifest and replaying once.")
    manifests.invalidate()
    responder.onStop = nil
    Task { await attempt(request, responder: responder, replayed: true) }
  }
}
