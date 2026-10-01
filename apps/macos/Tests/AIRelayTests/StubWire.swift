import Foundation
import Network

/// One HTTP/1.1 request: request line, lower-cased headers, and a `Content-Length` body.
struct StubHTTPRequest {
  let method: String
  let target: String
  let headers: [String: String]
  let body: Data

  /// Nil until the buffer holds the whole request.
  static func parse(_ buffer: Data) -> StubHTTPRequest? {
    guard let end = buffer.firstRange(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ")
    guard requestLine.count >= 2 else { return nil }
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = line[..<colon].lowercased()
      let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      headers[name] = headers[name].map { "\($0), \(value)" } ?? value
    }
    let length = Int(headers["content-length"] ?? "0") ?? 0
    let body = buffer[end.upperBound...]
    guard body.count >= length else { return nil }
    return StubHTTPRequest(
      method: String(requestLine[0]), target: String(requestLine[1]), headers: headers,
      body: Data(body.prefix(length)))
  }
}

/// The server side of one WebSocket: unmasks client frames, answers pings and close frames,
/// and sends unmasked text and close frames.
final class StubSocket: @unchecked Sendable {
  let connection: NWConnection
  private let onText: @Sendable (StubSocket, String) -> Void
  private var buffer = Data()

  init(connection: NWConnection, onText: @escaping @Sendable (StubSocket, String) -> Void) {
    self.connection = connection
    self.onText = onText
  }

  func read() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) {
      [self] data, _, complete, error in
      if let data { buffer.append(data) }
      while let frame = nextFrame() { handle(frame) }
      if complete || error != nil { return connection.cancel() }
      read()
    }
  }

  func send(text: String) {
    write(opcode: 0x1, payload: Data(text.utf8))
  }

  func close(code: UInt16, reason: String) {
    write(opcode: 0x8, payload: Data([UInt8(code >> 8), UInt8(code & 0xFF)]) + Data(reason.utf8))
  }

  private func handle(_ frame: (opcode: UInt8, payload: Data)) {
    switch frame.opcode {
    case 0x1: onText(self, String(decoding: frame.payload, as: UTF8.self))
    case 0x8: write(opcode: 0x8, payload: frame.payload.prefix(2))
    case 0x9: write(opcode: 0xA, payload: frame.payload)
    default: break
    }
  }

  private func nextFrame() -> (opcode: UInt8, payload: Data)? {
    let bytes = [UInt8](buffer)
    guard bytes.count >= 2 else { return nil }
    var length = Int(bytes[1] & 0x7F)
    var offset = 2
    if length == 126 {
      guard bytes.count >= 4 else { return nil }
      length = Int(bytes[2]) << 8 | Int(bytes[3])
      offset = 4
    } else if length == 127 {
      guard bytes.count >= 10 else { return nil }
      length = bytes[2..<10].reduce(0) { $0 << 8 | Int($1) }
      offset = 10
    }
    let masked = bytes[1] & 0x80 != 0
    let maskOffset = offset
    if masked { offset += 4 }
    guard bytes.count >= offset + length else { return nil }
    var payload = Array(bytes[offset..<offset + length])
    if masked {
      for index in payload.indices { payload[index] ^= bytes[maskOffset + index % 4] }
    }
    buffer = Data(bytes[(offset + length)...])
    return (bytes[0] & 0x0F, Data(payload))
  }

  private func write(opcode: UInt8, payload: Data) {
    var frame = Data([0x80 | opcode])
    if payload.count < 126 {
      frame.append(UInt8(payload.count))
    } else if payload.count <= 0xFFFF {
      frame.append(contentsOf: [126, UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)])
    } else {
      frame.append(127)
      for shift in stride(from: 56, through: 0, by: -8) {
        frame.append(UInt8((payload.count >> shift) & 0xFF))
      }
    }
    connection.send(content: frame + payload, completion: .idempotent)
  }
}
