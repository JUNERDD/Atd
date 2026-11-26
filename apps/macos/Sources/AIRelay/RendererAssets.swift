import AICore
import Foundation

/// Where renderer files come from.
public enum RendererSource: Equatable, Sendable {
  /// Release: the `dist-native` build copied to `Contents/Resources/renderer`.
  case bundle(URL)
  /// Debug: the Vite dev server `pnpm dev` runs; its HMR socket is opened by the page itself.
  case devServer(DevServerOrigin)
}

/// Serves non-`/v1` paths: files of the bundle, or in development the dev server's answer.
/// HTML documents get the generated CSP header; every answer gets an explicit type and
/// `nosniff`.
final class RendererAssets {
  private let source: RendererSource
  private let resolver: StaticFileResolver?
  private let decisionRing: RelayAndSupervisorRing?
  private var lastRecordedUpstreamErrorStatus: Int?
  private(set) var devRendererUnreachable = false
  var onDevRendererAvailabilityChange: (() -> Void)?

  init(source: RendererSource, decisionRing: RelayAndSupervisorRing? = nil) {
    self.source = source
    self.decisionRing = decisionRing
    if case .bundle(let root) = source {
      resolver = StaticFileResolver(root: root)
    } else {
      resolver = nil
    }
  }

  func serve(path: NormalizedPath, url: URL, method: String, to responder: SchemeResponder) {
    switch source {
    case .bundle:
      serveBundled(path, to: responder)
    case .devServer(let origin):
      proxy(path: path, url: url, method: method, origin: origin, to: responder)
    }
  }

  private func serveBundled(_ path: NormalizedPath, to responder: SchemeResponder) {
    guard let file = resolver?.resolve(path),
      let body = try? Data(contentsOf: file, options: .mappedIfSafe)
    else { return responder.error(status: 404, "No such renderer file.") }
    let type = RendererMIMEType.forFile(named: file.lastPathComponent)
    let cacheControl =
      path.encoded.hasPrefix("/assets/") && !RendererMIMEType.isHTML(type)
      ? "public, max-age=31536000, immutable"
      : "no-cache"
    var headers = [
      "Content-Type": type, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff",
    ]
    if RendererMIMEType.isHTML(type) {
      headers["Content-Security-Policy"] = ContentSecurityPolicy.production
    }
    responder.complete(status: 200, headers: headers, body: body)
  }

  /// Forwards to Vite with the raw path, which passed normalization (Vite does not decode
  /// `%40fs` back to `@fs`, so the canonical re-encoding would break `/@fs/` requests), and the
  /// query ``DevProxyRule`` allows.
  private func proxy(
    path: NormalizedPath, url: URL, method: String, origin: DevServerOrigin,
    to responder: SchemeResponder
  ) {
    let query: String?
    switch DevProxyRule.check(path, rawQuery: url.query(percentEncoded: true)) {
    case .success(let allowed): query = allowed
    case .failure: return responder.error(status: 403, "The dev proxy does not serve this path.")
    }
    let rawPath = url.path(percentEncoded: true)
    let suffix = query.map { "?\($0)" } ?? ""
    guard let target = URL(string: origin.httpOrigin + (rawPath.isEmpty ? "/" : rawPath) + suffix)
    else {
      return responder.error(status: 403, "The dev proxy does not serve this path.")
    }
    var request = URLRequest(url: target)
    request.httpMethod = method
    let accept = responder.request?.value(forHTTPHeaderField: "Accept")
    request.setValue(accept, forHTTPHeaderField: "Accept")
    let task = RelaySession.devAssets.dataTask(with: request) { data, response, error in
      MainActor.assumeIsolated {
        guard responder.isLive else { return }
        guard let http = response as? HTTPURLResponse, let data, error == nil else {
          let wasUnreachable = self.devRendererUnreachable
          let isEntry = path.encoded == "/" || path.encoded == "/index.html"
          self.devRendererUnreachable = true
          if !wasUnreachable || isEntry {
            self.recordDevRendererAnomaly(status: 502, detail: "dev_renderer_unreachable")
          }
          if !wasUnreachable { self.onDevRendererAvailabilityChange?() }
          let message =
            "The Vite dev server at \(origin.httpOrigin) is not reachable. Run pnpm dev."
          return responder.error(status: 502, message)
        }
        if self.devRendererUnreachable {
          self.devRendererUnreachable = false
          self.onDevRendererAvailabilityChange?()
        }
        if http.statusCode >= 500 {
          let isEntry = path.encoded == "/" || path.encoded == "/index.html"
          if isEntry || self.lastRecordedUpstreamErrorStatus != http.statusCode {
            self.lastRecordedUpstreamErrorStatus = http.statusCode
            self.recordDevRendererAnomaly(
              status: http.statusCode, detail: "dev_renderer_http_\(http.statusCode)")
          }
        } else {
          self.lastRecordedUpstreamErrorStatus = nil
        }
        let type =
          http.value(forHTTPHeaderField: "Content-Type")
          ?? RendererMIMEType.forFile(named: url.lastPathComponent)
        let upstreamCache = http.value(forHTTPHeaderField: "Cache-Control")
        let cacheControl =
          if !RendererMIMEType.isHTML(type), let upstreamCache,
            upstreamCache.localizedCaseInsensitiveContains("immutable")
          {
            upstreamCache
          } else {
            "no-cache"
          }
        var headers = [
          "Content-Type": type, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff",
        ]
        if RendererMIMEType.isHTML(type) {
          headers["Content-Security-Policy"] = ContentSecurityPolicy.development(hmr: origin)
        }
        responder.complete(status: http.statusCode, headers: headers, body: data)
      }
    }
    responder.onStop = { task.cancel() }
    task.resume()
  }

  private func recordDevRendererAnomaly(status: Int, detail: String) {
    guard let decisionRing else { return }
    var entry = RelayAndSupervisorEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.subsystem = 3
    entry.eventKind = 1
    entry.outcome = 2
    entry.httpOrWsCode = UInt16(clamping: status)
    entry.detail = InlineText64(truncatingUTF8: detail)
    decisionRing.append(entry)
  }
}
