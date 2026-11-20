import Foundation
import Synchronization

@testable import AtdAI

/// Answers requests to one made-up host with scripted responses, delivering each body in the
/// pieces given, and records every request with its body. Each stub has its own host, so tests
/// running in parallel never see each other's requests.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
  struct Reply: Sendable {
    var status = 200
    var headers = ["Content-Type": "text/event-stream"]
    var pieces: [Data] = []
    /// Never answer, to run into the connect deadline.
    var hangs = false
  }

  struct Recorded: Sendable {
    var url: URL
    var method: String
    var headers: [String: String]
    var body: Data

    /// The body as a JSON object.
    var json: [String: Any] {
      (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
    }
  }

  private struct Stub {
    /// Answered in order; the last one answers every request after it.
    var replies: [Reply]
    var requests: [Recorded] = []
  }

  private static let stubs = Mutex<[String: Stub]>([:])

  /// A host that answers with `replies`, and a session routed to it.
  static func host(_ replies: Reply...) -> StubHost {
    let name = "\(UUID().uuidString.lowercased()).test"
    stubs.withLock { $0[name] = Stub(replies: replies) }
    let configuration = URLSessionConfiguration.models
    configuration.protocolClasses = [StubURLProtocol.self]
    guard let baseURL = URL(string: "https://\(name)/v1") else { preconditionFailure() }
    return StubHost(name: name, baseURL: baseURL, session: URLSession(configuration: configuration))
  }

  static func requests(to host: String) -> [Recorded] {
    stubs.withLock { $0[host]?.requests ?? [] }
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url, let host = url.host() else { return }
    let recorded = Recorded(
      url: url, method: request.httpMethod ?? "GET",
      headers: request.allHTTPHeaderFields ?? [:], body: Self.body(of: request))
    let reply = Self.stubs.withLock { stubs -> Reply? in
      guard var stub = stubs[host] else { return nil }
      stub.requests.append(recorded)
      let index = min(stub.requests.count, stub.replies.count) - 1
      stubs[host] = stub
      return stub.replies[index]
    }
    guard let reply, !reply.hangs else { return }
    guard
      let response = HTTPURLResponse(
        url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    for piece in reply.pieces { client?.urlProtocol(self, didLoad: piece) }
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  /// A session hands the body to a protocol as a stream.
  private static func body(of request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      guard count > 0 else { break }
      data.append(buffer, count: count)
    }
    return data
  }
}

struct StubHost {
  let name: String
  let baseURL: URL
  let session: URLSession

  var requests: [StubURLProtocol.Recorded] { StubURLProtocol.requests(to: name) }
}

extension StubURLProtocol.Reply {
  /// A streamed answer: `body` split into pieces of `size` bytes, so lines, line endings and
  /// characters fall across pieces.
  static func events(_ body: String, pieceSize size: Int = 7) -> Self {
    Self(pieces: Data(body.utf8).pieces(of: size))
  }

  /// An error response with a JSON body.
  static func error(_ status: Int, _ body: String, headers: [String: String] = [:]) -> Self {
    Self(
      status: status, headers: headers.merging(["Content-Type": "application/json"]) { $1 },
      pieces: [Data(body.utf8)])
  }

  /// A successful JSON response.
  static func json(_ body: String) -> Self {
    Self(headers: ["Content-Type": "application/json"], pieces: [Data(body.utf8)])
  }
}

extension Data {
  func pieces(of size: Int) -> [Data] {
    stride(from: 0, to: count, by: size).map { subdata(in: $0..<Swift.min($0 + size, count)) }
  }
}

/// Reads a whole answer: its text, and how it ended.
func collect(_ stream: AsyncThrowingStream<String, any Error>) async -> (
  text: String, error: (any Error)?
) {
  var text = ""
  do {
    for try await delta in stream { text += delta }
    return (text, nil)
  } catch {
    return (text, error)
  }
}

/// An in-memory key store for runner tests.
final class MemorySecrets: SecretStoring {
  private let keys = Mutex<[String: String]>([:])

  func key(for connectionID: String) -> String? { keys.withLock { $0[connectionID] } }
  func setKey(_ key: String, for connectionID: String) { keys.withLock { $0[connectionID] = key } }
  func removeKey(for connectionID: String) {
    keys.withLock { _ = $0.removeValue(forKey: connectionID) }
  }
}
