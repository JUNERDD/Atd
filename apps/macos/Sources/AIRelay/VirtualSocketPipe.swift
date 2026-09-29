import AICore
import Foundation
import WebKit

/// The page's stream connections for one web view (decisions Q4, Q5-B): each virtual socket is
/// one `URLSessionWebSocketTask` to `/v1/stream` with the main token. The pipe is transparent
/// and stateless: downstream text is passed on unparsed, close codes and reasons are forwarded
/// unchanged, and nothing is ever reconnected here; the page's stream client owns reconnect,
/// backoff, resume and subscribe. Upstream, only `subscribe` and `ping` pass
/// (``UpstreamFrameFilter``); anything else closes the socket with 1008.
///
/// The owner must:
/// - call ``receive(_:)`` from the bridge's script message handler, for messages of the main
///   frame of an `ai-app://renderer` page only;
/// - call ``resetForNewDocument()`` when the main frame commits a new document (navigation,
///   reload) and when the web content process terminates;
/// - call ``invalidate()`` when the web view is torn down.
@MainActor
public final class VirtualSocketPipe {
  /// Far above the page's needs (one stream client per window), low enough to bound a page
  /// that opens sockets in a loop.
  public static let maxSockets = 16
  /// Frames a page may send before its socket opened; the browser would throw instead.
  public static let maxQueuedSends = 32

  /// RFC 6455 codes the pipe itself uses besides 1008 and 1012.
  public enum CloseCode {
    public static let goingAway: UInt16 = 1001
    public static let unsupportedData: UInt16 = 1003
    public static let noStatus: UInt16 = 1005
    public static let tryAgainLater: UInt16 = 1013
  }

  private let link: ServiceLink
  private let delivery: WebViewFrameDelivery
  private var sockets: [String: VirtualSocket] = [:]
  private var observation: ServiceLinkObservation?
  private var document = 0
  private var invalidated = false

  public init(webView: WKWebView, link: ServiceLink, contentWorld: WKContentWorld = .page) {
    self.link = link
    delivery = WebViewFrameDelivery(webView: webView, contentWorld: contentWorld)
    observation = link.observeChanges { [weak self] current in
      self?.closeAll(
        except: current, code: WebSocketCloseCode.serviceRestart,
        reason: "The agent service restarted.")
    }
  }

  public var socketCount: Int { sockets.count }

  public func receive(_ command: VirtualSocketCommand) {
    guard !invalidated else { return }
    switch command {
    case .open(let id): open(id)
    case .send(let id, let text): send(text, on: id)
    case .close(let id, let code, let reason):
      guard let socket = sockets.removeValue(forKey: id) else { return }
      socket.upstream?.close(code: code ?? 1000, reason: reason)
      delivery.deliver(.close(id, code: code ?? CloseCode.noStatus, reason: reason))
    }
  }

  /// Closes every socket of the document that is going away. Nothing is delivered: the frames
  /// would reach the next document.
  public func resetForNewDocument() {
    document += 1
    let closing = sockets.values
    sockets = [:]
    for socket in closing {
      socket.upstream?.close(code: CloseCode.goingAway, reason: "The page went away.")
    }
    delivery.discardPending()
  }

  /// Teardown: closes everything and ignores later messages.
  public func invalidate() {
    resetForNewDocument()
    invalidated = true
    observation?.cancel()
    observation = nil
  }

  /// Closes every socket not connected to `endpoint`'s instance and tells the page, whose
  /// stream client then reconnects with its own backoff.
  public func closeAll(except endpoint: ServiceEndpoint? = nil, code: UInt16, reason: String) {
    for (id, socket) in sockets {
      if let endpoint {
        // Sockets still resolving will connect to the current instance anyway.
        guard let upstream = socket.upstream, !upstream.endpoint.isSameInstance(as: endpoint)
        else { continue }
      }
      terminate(id, code: code, reason: reason)
    }
  }

  private func open(_ id: String) {
    guard sockets[id] == nil else { return }
    guard sockets.count < Self.maxSockets else {
      let reason = "Too many stream connections."
      return delivery.deliver(.close(id, code: WebSocketCloseCode.policyViolation, reason: reason))
    }
    let socket = VirtualSocket()
    sockets[id] = socket
    let document = document
    Task { @MainActor in
      let resolved = await link.endpoint()
      guard document == self.document, sockets[id] === socket else { return }
      guard case .success(let endpoint) = resolved else {
        sockets[id] = nil
        return delivery.deliver(
          .close(id, code: CloseCode.tryAgainLater, reason: "The agent service is not available."))
      }
      let upstream = ServiceWebSocket(endpoint: endpoint, events: events(for: id, socket))
      socket.upstream = upstream
      upstream.start()
    }
  }

  private func events(for id: String, _ socket: VirtualSocket) -> ServiceWebSocket.Events {
    ServiceWebSocket.Events(
      onOpen: { [weak self] in
        guard let self, sockets[id] === socket else { return }
        socket.isOpen = true
        delivery.deliver(.open(id))
        let queued = socket.queued
        socket.queued = []
        for text in queued { send(text, on: id) }
      },
      onText: { [weak self] text in
        guard let self, sockets[id] === socket else { return }
        delivery.deliver(.message(id, text: text))
      },
      onBinary: { [weak self] in
        guard let self, sockets[id] === socket else { return }
        terminate(id, code: CloseCode.unsupportedData, reason: "Binary frames are not relayed.")
      },
      onClose: { [weak self] code, reason in
        guard let self, sockets[id] === socket else { return }
        sockets[id] = nil
        delivery.deliver(.close(id, code: code, reason: reason))
      })
  }

  private func send(_ text: String, on id: String) {
    guard let socket = sockets[id] else { return }
    guard socket.isOpen, let upstream = socket.upstream else {
      guard socket.queued.count < Self.maxQueuedSends else {
        return terminate(
          id, code: WebSocketCloseCode.policyViolation, reason: "Too many frames before open.")
      }
      socket.queued.append(text)
      return
    }
    switch UpstreamFrameFilter.check(.text(text)) {
    case .forward:
      upstream.send(text)
    case .close(let code, let reason):
      terminate(id, code: code, reason: reason)
    }
  }

  /// Closes one socket from the shell's side and tells the page.
  private func terminate(_ id: String, code: UInt16, reason: String) {
    guard let socket = sockets.removeValue(forKey: id) else { return }
    socket.upstream?.close(code: code, reason: reason)
    delivery.deliver(.close(id, code: code, reason: reason))
  }
}

@MainActor
private final class VirtualSocket {
  var upstream: ServiceWebSocket?
  var isOpen = false
  var queued: [String] = []
}
