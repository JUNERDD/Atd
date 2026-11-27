import AIChromeChannelKit
import AICore
import Foundation
import Network
import OSLog

/// The loopback WebSocket one connected Chrome's browser worker attaches to (D8):
/// `ws://127.0.0.1:<random port>/devtools/browser/<uuid>`, the shape the worker accepts
/// (`apps/agent-service/src/computer/worker/connection.ts`), bound to 127.0.0.1 only. The uuid is a
/// capability: a request for any other path, from another host name, or with an `Origin` is
/// refused before the upgrade. Each accepted worker connection is a `conn` of the channel
/// (`cdp.open`), whose text messages go to Atd for Chrome as `cdp` frames and come back from it
/// the same way, until either side ends it (`cdp.close`); the extension translates and filters
/// the CDP. The relay lives as long as its ``ChromeLink`` and ends with it.
///
/// Reuse (AGENTS.md › Community Reuse): Network.framework's `NWProtocolWebSocket` server cannot
/// check the request path, which is the capability here: its client-request handler sees only the
/// offered subprotocols and additional headers (`setClientRequestHandler(_:handler:)` in
/// Network.swiftinterface; `nw_ws_request_t` exposes only `nw_ws_request_enumerate_subprotocols`
/// and `nw_ws_request_enumerate_additional_headers`, Network.framework/Headers/ws_options.h).
/// `URLSessionWebSocketTask` is client-only. SwiftNIO's `NIOWebSocket` does see the request head,
/// but would bring swift-nio, NIOHTTP1 and NIOWebSocket into the app (today they never reach it,
/// Package.swift) for one loopback text pipe. So the relay speaks the minimal RFC 6455 server
/// over `NWListener`/`NWConnection` itself: text and continuation frames, ping/pong and close, no
/// extensions, no subprotocols.
final class ChromeCDPRelay {
  private enum Listening {
    case starting
    case ready(port: UInt16)
    case failed(String)
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-cdp")

  /// Worker connections one relay holds at once (a worker opens one).
  static let maxConnections = 4

  /// `/devtools/browser/<uuid>`, the capability path.
  let browserPath = "/devtools/browser/" + UUID().uuidString.lowercased()
  private weak var link: ChromeLink?
  private let onDiagnostic: (ShellLogWriter.Level, String) -> Void
  private var listener: NWListener?
  private var listening = Listening.starting
  private var waiters: [CheckedContinuation<Result<String, ComputerFailure>, Never>] = []
  /// Open worker connections by their `conn`.
  private var sockets: [String: CDPRelaySocket] = [:]
  /// Connections still in their handshake.
  private var accepting: [ObjectIdentifier: CDPRelaySocket] = [:]
  private var serial = 0

  init(
    link: ChromeLink,
    onDiagnostic: @escaping (ShellLogWriter.Level, String) -> Void = { _, _ in }
  ) {
    self.link = link
    self.onDiagnostic = onDiagnostic
  }

  /// Starts listening on a random loopback port and takes the link's CDP frames.
  func start() {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
    let listener: NWListener
    do {
      listener = try NWListener(using: parameters)
    } catch {
      Self.log.error("CDP relay failed to listen: \(error.localizedDescription, privacy: .public)")
      onDiagnostic(.error, "relay_listen_failed: \(error.localizedDescription)")
      fail("The relay could not listen: \(error.localizedDescription)")
      return
    }
    self.listener = listener
    listener.stateUpdateHandler = { [weak self] state in
      MainActor.assumeIsolated { self?.listenerChanged(state) }
    }
    listener.newConnectionHandler = { [weak self] connection in
      MainActor.assumeIsolated {
        guard let self else { return connection.cancel() }
        self.accept(connection)
      }
    }
    listener.start(queue: .main)
    link?.onCDP = { [weak self] conn, msg in self?.sockets[conn]?.send(msg) }
  }

  /// The websocket the worker connects to, once the relay listens.
  func webSocketURL() async throws(ComputerFailure) -> String {
    let result: Result<String, ComputerFailure>
    switch listening {
    case .ready(let port): result = .success(url(port))
    case .failed(let why): result = .failure(Self.failure(why))
    case .starting: result = await withCheckedContinuation { waiters.append($0) }
    }
    return try result.get()
  }

  /// Ends every connection and stops listening; the link is gone, or going.
  func stop() {
    listener?.cancel()
    listener = nil
    fail("The connection to Atd for Chrome ended.")
    for socket in Array(sockets.values) + Array(accepting.values) { socket.close(code: 1001) }
    sockets = [:]
    accepting = [:]
  }

  // MARK: Listener

  private func listenerChanged(_ state: NWListener.State) {
    switch state {
    case .ready:
      guard let port = listener?.port?.rawValue else {
        onDiagnostic(.error, "relay_listener_no_port")
        return fail("The relay listens on no port.")
      }
      listening = .ready(port: port)
      resume(.success(url(port)))
    case .failed(let error):
      Self.log.error("CDP relay listener failed: \(error.localizedDescription, privacy: .public)")
      onDiagnostic(.error, "relay_listener_failed: \(error.localizedDescription)")
      listener?.cancel()
      fail("The relay stopped listening: \(error.localizedDescription)")
    case .cancelled:
      fail("The relay stopped listening.")
    default:
      break
    }
  }

  private func accept(_ connection: NWConnection) {
    guard case .ready(let port) = listening, Self.isLoopback(connection.endpoint),
      sockets.count + accepting.count < Self.maxConnections, link?.isConnected == true
    else {
      onDiagnostic(.warn, "relay_connection_rejected")
      return connection.cancel()
    }
    let socket = CDPRelaySocket(
      connection: connection, path: browserPath, host: "127.0.0.1:\(port)")
    socket.onDiagnostic = onDiagnostic
    let key = ObjectIdentifier(socket)
    accepting[key] = socket
    socket.onOpen = { [weak self, weak socket] in
      guard let self, let socket else { return }
      self.opened(socket, key: key)
    }
    socket.start()
  }

  /// The worker upgraded: the connection becomes a `conn` of the channel.
  private func opened(_ socket: CDPRelaySocket, key: ObjectIdentifier) {
    accepting[key] = nil
    guard let link, link.isConnected else { return socket.close(code: 1001) }
    serial += 1
    let conn = "w\(serial)"
    sockets[conn] = socket
    socket.onText = { [weak link] msg in link?.send(.cdp(conn: conn, msg: msg)) }
    socket.onClose = { [weak self, weak link] in
      self?.sockets[conn] = nil
      link?.send(.cdpClose(conn: conn))
    }
    link.send(.cdpOpen(conn: conn))
  }

  // MARK: Helpers

  private func url(_ port: UInt16) -> String { "ws://127.0.0.1:\(port)\(browserPath)" }

  private func fail(_ why: String) {
    listening = .failed(why)
    resume(.failure(Self.failure(why)))
  }

  private func resume(_ result: Result<String, ComputerFailure>) {
    let waiting = waiters
    waiters = []
    for waiter in waiting { waiter.resume(returning: result) }
  }

  private static func failure(_ why: String) -> ComputerFailure {
    ComputerFailure(
      .engineFailed, "The browser connection to Atd for Chrome is unavailable: " + why)
  }

  private static func isLoopback(_ endpoint: NWEndpoint) -> Bool {
    guard case .hostPort(let host, _) = endpoint else { return false }
    switch host {
    case .ipv4(let address): return address.isLoopback
    case .ipv6(let address): return address.isLoopback
    default: return false
    }
  }
}
