import AICore
import Foundation
import Network
import Testing

/// A gated local import endpoint: it reads source files only when the test permits it, proving
/// cancellation cannot delete paths while an already-started import still owns them.
@MainActor
final class RecordingImportStub {
  let token = String(repeating: "r", count: 43)
  private let listener: NWListener
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var waiting: NWConnection?
  private(set) var paths: [String] = []
  private(set) var requests = 0

  init() throws {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  func start() async throws -> Int {
    listener.newConnectionHandler = { [weak self] connection in
      Task { @MainActor in self?.accept(connection) }
    }
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
      listener.start(queue: .main)
    }
  }

  /// Reads every path before acknowledging the import, as the real service does.
  @discardableResult
  func finishImport() throws -> Int {
    let connection = try #require(waiting)
    var bytes = 0
    let imported = try paths.enumerated().map { index, path in
      let file = URL(filePath: path)
      let count = try Data(contentsOf: file).count
      bytes += count
      return ResourceImportResponse.Imported(
        path: path,
        resource: ResourceRef(
          id: "recording-test-\(index)", name: file.lastPathComponent, size: count,
          mime: file.pathExtension == "md" ? "text/markdown" : "image/jpeg", taskId: nil,
          createdAt: "2026-11-09T00:00:00Z"))
    }
    let body = try JSONEncoder().encode(ResourceImportResponse(imported: imported, failures: []))
    waiting = nil
    send(connection, status: 200, body: body)
    return bytes
  }

  func stop() {
    listener.cancel()
    for connection in connections.values { connection.cancel() }
    connections.removeAll()
    waiting = nil
  }

  private func accept(_ connection: NWConnection) {
    connections[ObjectIdentifier(connection)] = connection
    connection.start(queue: .main)
    read(connection, buffer: Data())
  }

  private func read(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
      [weak self] content, _, complete, error in
      Task { @MainActor in
        guard let self else { return }
        var received = buffer
        if let content { received.append(content) }
        if let split = received.range(of: Data("\r\n\r\n".utf8)) {
          let header = String(decoding: received[..<split.lowerBound], as: UTF8.self)
          let lines = header.components(separatedBy: "\r\n")
          let length =
            lines.first { $0.lowercased().hasPrefix("content-length:") }
            .flatMap {
              Int($0.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces))
            }
            ?? 0
          let body = received[split.upperBound...]
          if body.count >= length {
            guard lines.first == "POST /v1/resources/import HTTP/1.1",
              lines.contains(where: { $0.lowercased() == "authorization: bearer \(self.token)" }),
              let request = try? JSONDecoder().decode(
                Request.self, from: Data(body.prefix(length))),
              self.waiting == nil
            else { return self.send(connection, status: 400, body: Data()) }
            self.paths = request.paths
            self.requests += 1
            self.waiting = connection
            return
          }
        }
        guard !complete, error == nil else {
          connection.cancel()
          self.connections.removeValue(forKey: ObjectIdentifier(connection))
          return
        }
        self.read(connection, buffer: received)
      }
    }
  }

  private func send(_ connection: NWConnection, status: Int, body: Data) {
    let head =
      "HTTP/1.1 \(status) Result\r\nContent-Length: \(body.count)\r\n"
      + "Content-Type: application/json\r\nConnection: close\r\n\r\n"
    connection.send(
      content: Data(head.utf8) + body,
      completion: .contentProcessed { _ in
        connection.cancel()
      })
    connections.removeValue(forKey: ObjectIdentifier(connection))
  }

  private struct Request: Decodable { let paths: [String] }
}
