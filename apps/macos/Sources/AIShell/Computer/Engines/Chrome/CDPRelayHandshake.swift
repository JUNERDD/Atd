import CryptoKit
import Foundation

/// The opening handshake of the relay's WebSocket server (RFC 6455 §4.2): one `GET` of the exact
/// capability path, from the loopback host the relay serves, with no `Origin` (the worker's
/// WebSocket client sends none, while every web page's does), upgraded with no subprotocol and no
/// extension. The client offers `permessage-deflate`; answering without it leaves frames
/// uncompressed, as the RFC requires.
enum CDPRelayHandshake {
  enum Outcome: Equatable {
    /// More request bytes are needed.
    case incomplete
    /// The `101` answer; the request used the first `consumed` bytes.
    case accept(response: Data, consumed: Int)
    /// An HTTP error answer, after which the connection closes.
    case refuse(Data)
  }

  /// The largest request head the relay reads.
  static let maxRequest = 16 * 1024
  private static let guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
  private static let terminator: [UInt8] = [13, 10, 13, 10]

  /// What `bytes` (everything received so far) amounts to for a relay serving `path` at `host`
  /// (`127.0.0.1:<port>`).
  static func evaluate(_ bytes: [UInt8], path: String, host: String) -> Outcome {
    guard let end = headEnd(bytes) else {
      return bytes.count > maxRequest
        ? .refuse(refusal(431, "Request Header Fields Too Large")) : .incomplete
    }
    guard end <= maxRequest,
      let head = String(bytes: bytes[..<end], encoding: .utf8)
    else { return .refuse(refusal(400, "Bad Request")) }
    var lines = head.components(separatedBy: "\r\n")
    let request = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: false)
    guard request.count == 3, request[0] == "GET", request[2] == "HTTP/1.1" else {
      return .refuse(refusal(400, "Bad Request"))
    }
    guard matches(String(request[1]), path) else { return .refuse(refusal(404, "Not Found")) }
    guard let headers = fields(lines) else { return .refuse(refusal(400, "Bad Request")) }
    guard headers["origin"] == nil, headers["host"] == host else {
      return .refuse(refusal(403, "Forbidden"))
    }
    let connection = (headers["connection"] ?? "").lowercased().split(separator: ",").map {
      $0.trimmingCharacters(in: .whitespaces)
    }
    guard headers["upgrade"]?.lowercased() == "websocket", connection.contains("upgrade"),
      headers["sec-websocket-version"] == "13", let key = headers["sec-websocket-key"],
      Data(base64Encoded: key)?.count == 16
    else { return .refuse(refusal(400, "Bad Request")) }
    let digest = Insecure.SHA1.hash(data: Data((key + guid).utf8))
    let response =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
      + "Sec-WebSocket-Accept: \(Data(digest).base64EncodedString())\r\n\r\n"
    return .accept(response: Data(response.utf8), consumed: end + terminator.count)
  }

  /// Where the head ends (the index of its blank line), if it has arrived.
  private static func headEnd(_ bytes: [UInt8]) -> Int? {
    guard bytes.count >= terminator.count else { return nil }
    for index in 0...(bytes.count - terminator.count)
    where bytes[index] == 13 && bytes[index + 1] == 10 && bytes[index + 2] == 13
      && bytes[index + 3] == 10
    {
      return index
    }
    return nil
  }

  /// The header fields by lowercased name; nil for a malformed line or a repeated field, so no
  /// field the checks read can be smuggled in twice.
  private static func fields(_ lines: [String]) -> [String: String]? {
    var fields: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { return nil }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      guard !name.isEmpty, fields[name] == nil else { return nil }
      fields[name] = value
    }
    return fields
  }

  /// Compares the request target with the capability path in time independent of where they
  /// differ.
  private static func matches(_ target: String, _ path: String) -> Bool {
    let lhs = Array(target.utf8)
    let rhs = Array(path.utf8)
    guard lhs.count == rhs.count else { return false }
    return zip(lhs, rhs).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
  }

  private static func refusal(_ status: Int, _ reason: String) -> Data {
    Data("HTTP/1.1 \(status) \(reason)\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".utf8)
  }
}
