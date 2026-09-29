import AICore
import CryptoKit
import Foundation
import Network

/// A loopback stand-in for agent-service: HTTP/1.1 (one request per connection) and the
/// `/v1/stream` WebSocket on one OS-assigned port. It records what reached it so tests can prove
/// what the relay forwarded and what it kept out.
final class StubService: @unchecked Sendable {
  struct Hit: Sendable {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
  }

  let token = String(repeating: "k", count: 43)
  private let queue = DispatchQueue(label: "stub-service")
  private let listener: NWListener
  private let lock = NSLock()
  private var _epoch = 3
  private var _hits: [Hit] = []
  private var _frames: [String] = []
  private var sockets: [StubSocket] = []

  init() throws {
    listener = try NWListener(using: .tcp, on: .any)
  }

  var epoch: Int {
    get { lock.withLock { _epoch } }
    set { lock.withLock { _epoch = newValue } }
  }
  var hits: [Hit] { lock.withLock { _hits } }
  /// Text frames received on stream connections, in order.
  var frames: [String] { lock.withLock { _frames } }

  func start() async throws -> Int {
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    return try await withCheckedThrowingContinuation { continuation in
      listener.stateUpdateHandler = { [listener] state in
        switch state {
        case .ready:
          listener.stateUpdateHandler = nil
          continuation.resume(returning: Int(listener.port!.rawValue))
        case .failed(let error):
          listener.stateUpdateHandler = nil
          continuation.resume(throwing: error)
        default: break
        }
      }
      listener.start(queue: queue)
    }
  }

  func stop() {
    listener.cancel()
    for socket in lock.withLock({ sockets }) { socket.connection.cancel() }
  }

  /// Sends a text frame to every open stream connection.
  func broadcast(_ text: String) {
    for socket in lock.withLock({ sockets }) { socket.send(text: text) }
  }

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    readRequest(connection, buffer: Data())
  }

  private func readRequest(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) {
      [weak self] data, _, complete, error in
      guard let self, error == nil else { return connection.cancel() }
      let buffer = buffer + (data ?? Data())
      guard let request = StubHTTPRequest.parse(buffer) else {
        return complete ? connection.cancel() : readRequest(connection, buffer: buffer)
      }
      lock.withLock {
        _hits.append(
          Hit(
            method: request.method, path: request.target, headers: request.headers,
            body: request.body))
      }
      if request.headers["upgrade"]?.lowercased() == "websocket" {
        upgrade(connection, request)
      } else {
        let (status, headers, body) = respond(to: request)
        send(connection, status: status, headers: headers, body: body)
      }
    }
  }

  private func authorized(_ request: StubHTTPRequest) -> Bool {
    request.headers["authorization"] == "Bearer \(token)"
  }

  /// Plays the Vite dev server for paths outside `/v1`: an `index.html` with the React refresh
  /// preamble inline, the refresh runtime it imports, and a module that reports it ran.
  static let devIndex = """
    <!doctype html><html><head><script type="module">\(ContentSecurityPolicy.reactRefreshPreamble)</script>
    <script>window.__inlineRan = true;</script>
    <script type="module" src="/src/main.js?t=1"></script></head><body>dev</body></html>
    """

  private func respondAsDevServer(_ path: String) -> (Int, [String: String], Data) {
    switch path {
    case "/":
      return (200, ["Content-Type": "text/html"], Data(Self.devIndex.utf8))
    case "/@react-refresh":
      let module = "export function injectIntoGlobalHook(w) { w.__refreshHooked = true; }"
      return (200, ["Content-Type": "text/javascript"], Data(module.utf8))
    case "/src/main.js":
      return (200, ["Content-Type": "text/javascript"], Data("window.__mainRan = true;".utf8))
    default:
      return (404, ["Content-Type": "text/plain"], Data("missing".utf8))
    }
  }

  private func respond(to request: StubHTTPRequest) -> (Int, [String: String], Data) {
    let target = request.target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    if !target.hasPrefix("/v1/") { return respondAsDevServer(target) }
    guard authorized(request) else {
      return (401, [:], Data(#"{"error":{"code":"unauthorized","message":"no"}}"#.utf8))
    }
    let epoch = self.epoch
    if let sent = request.headers["x-relay-epoch"], sent != String(epoch) {
      return (
        409, ["x-relay-epoch-current": String(epoch)],
        Data(#"{"error":{"code":"epoch_mismatch","message":"stale"}}"#.utf8)
      )
    }
    let path = request.target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    switch (request.method, path) {
    case ("GET", "/v1/admin/routes"):
      let routes = [
        ("GET", "/v1/echo", "renderer"), ("POST", "/v1/echo", "renderer"),
        ("GET", "/v1/tasks/:taskId", "renderer"), ("GET", "/v1/conflict", "renderer"),
        ("GET", "/v1/chunks", "renderer"), ("GET", "/v1/hang", "renderer"),
        ("GET", "/v1/admin/routes", "shell"), ("POST", "/v1/admin/shutdown", "shell"),
        ("GET", "/v1/admin/shutdown", "shell"), ("GET", "/v1/stream", "shell"),
      ].map { #"{"method":"\#($0.0)","pathPattern":"\#($0.1)","exposure":"\#($0.2)"}"# }
      return (
        200, [:], Data(#"{"epoch":\#(epoch),"routes":[\#(routes.joined(separator: ","))]}"#.utf8)
      )
    case ("GET", "/v1/conflict"):
      return (409, [:], Data(#"{"error":{"code":"conflict","message":"business"}}"#.utf8))
    case ("GET", "/v1/chunks"):
      return (
        200, ["Content-Type": "text/plain"],
        Data(String(repeating: "0123456789", count: 20_000).utf8)
      )
    case ("GET", "/v1/hang"):
      return (-1, [:], Data())
    default:
      let echo: [String: Any] = [
        "method": request.method, "target": request.target, "bodyBytes": request.body.count,
        "body": String(decoding: request.body, as: UTF8.self),
      ]
      return (
        200, ["Content-Type": "application/json", "x-service-id": "svc", "Set-Cookie": "a=b"],
        try! JSONSerialization.data(withJSONObject: echo)
      )
    }
  }

  private func send(_ connection: NWConnection, status: Int, headers: [String: String], body: Data)
  {
    guard status > 0 else { return }  // /v1/hang: never answer
    var head = "HTTP/1.1 \(status) Status\r\nContent-Length: \(body.count)\r\nConnection: close\r\n"
    for (name, value) in headers { head += "\(name): \(value)\r\n" }
    connection.send(
      content: Data((head + "\r\n").utf8) + body,
      completion: .contentProcessed { _ in connection.cancel() })
  }

  private func upgrade(_ connection: NWConnection, _ request: StubHTTPRequest) {
    guard authorized(request), let key = request.headers["sec-websocket-key"] else {
      return send(connection, status: 401, headers: [:], body: Data())
    }
    let accept = Data(
      Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
    )
    .base64EncodedString()
    var head = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    head += "Sec-WebSocket-Accept: \(accept)\r\n"
    if request.headers["sec-websocket-protocol"]?.contains("ai.v1") == true {
      head += "Sec-WebSocket-Protocol: ai.v1\r\n"
    }
    connection.send(content: Data((head + "\r\n").utf8), completion: .idempotent)
    let socket = StubSocket(connection: connection) { [weak self] socket, text in
      self?.received(text, on: socket)
    }
    lock.withLock { sockets.append(socket) }
    socket.read()
  }

  /// Stream behavior: echo subscribes, answer pings and registrations, close on request.
  private func received(_ text: String, on socket: StubSocket) {
    lock.withLock { _frames.append(text) }
    let object = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
    switch object?["type"] as? String {
    case "ping":
      socket.send(text: #"{"type":"pong"}"#)
    case "subscribe":
      if (object?["taskIds"] as? [String])?.first == "close-me" {
        return socket.close(code: 4001, reason: "bye")
      }
      if object?["status"] as? Bool == true {
        socket.send(text: #"{"type":"status","running":2,"attention":1}"#)
      } else {
        socket.send(text: #"{"type":"echo","frame":\#(text)}"#)
      }
    case "capability.register":
      socket.send(text: #"{"type":"capability.registered","clientId":"client-1"}"#)
    case "capability.result":
      let id = ((object?["result"] as? [String: Any])?["requestId"] as? String) ?? ""
      socket.send(text: #"{"type":"capability.ack","requestId":"\#(id)","ok":true}"#)
    default:
      break
    }
  }
}
