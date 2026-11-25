import Foundation

/// The relay's server-side WebSocket framing (RFC 6455 §5): it reads masked client frames, joins a
/// fragmented text message, answers nothing itself and leaves pings and closes to the socket; it
/// writes unmasked server frames. No extension is negotiated, so a frame with an RSV bit set is a
/// protocol error, and CDP is text, so a binary message is refused as unsupported data.
struct WebSocketFrameDecoder {
  enum Event: Equatable {
    case text(String)
    case ping(Data)
    /// The peer's close.
    case close
  }

  /// Why the connection must close, with the status code to close it with.
  struct Failure: Error, Equatable {
    let code: UInt16
  }

  /// The largest message the relay takes from the worker.
  static let maxMessage = 16 * 1024 * 1024

  private var bytes: [UInt8] = []
  private var head = 0
  /// The text message whose continuation frames are still due.
  private var fragments: [UInt8]?

  mutating func append(_ data: Data) {
    if head > 65536, head * 2 > bytes.count {
      bytes.removeFirst(head)
      head = 0
    }
    bytes.append(contentsOf: data)
  }

  /// The next complete event, nil until more bytes arrive.
  mutating func next() throws(Failure) -> Event? {
    while true {
      let available = bytes.count - head
      guard available >= 2 else { return nil }
      let first = bytes[head]
      let second = bytes[head + 1]
      let fin = first & 0x80 != 0
      let opcode = first & 0x0F
      // RSV bits without an extension, or an unmasked client frame.
      guard first & 0x70 == 0, second & 0x80 != 0 else { throw Failure(code: 1002) }
      var length = UInt64(second & 0x7F)
      var offset = 2
      if length == 126 {
        guard available >= 4 else { return nil }
        length = UInt64(bytes[head + 2]) << 8 | UInt64(bytes[head + 3])
        offset = 4
      } else if length == 127 {
        guard available >= 10 else { return nil }
        length = (0..<8).reduce(0) { $0 << 8 | UInt64(bytes[head + 2 + $1]) }
        offset = 10
      }
      let control = opcode & 0x08 != 0
      if control, !fin || length > 125 { throw Failure(code: 1002) }
      guard length <= UInt64(Self.maxMessage - (fragments?.count ?? 0)) else {
        throw Failure(code: 1009)
      }
      let total = offset + 4 + Int(length)
      guard available >= total else { return nil }
      let payload = unmasked(at: head + offset, count: Int(length))
      head += total
      switch opcode {
      case 0x0:
        guard var message = fragments else { throw Failure(code: 1002) }
        message.append(contentsOf: payload)
        guard fin else {
          fragments = message
          continue
        }
        fragments = nil
        return .text(try Self.text(message))
      case 0x1:
        guard fragments == nil else { throw Failure(code: 1002) }
        guard fin else {
          fragments = payload
          continue
        }
        return .text(try Self.text(payload))
      case 0x2: throw Failure(code: 1003)
      case 0x8:
        // A close body is empty or starts with a two-byte status code.
        guard payload.count != 1 else { throw Failure(code: 1002) }
        return .close
      case 0x9: return .ping(Data(payload))
      case 0xA: continue
      default: throw Failure(code: 1002)
      }
    }
  }

  /// The payload at `start` (after its four mask bytes) unmasked.
  private func unmasked(at start: Int, count: Int) -> [UInt8] {
    let mask = Array(bytes[start..<(start + 4)])
    var payload = Array(bytes[(start + 4)..<(start + 4 + count)])
    payload.withUnsafeMutableBufferPointer { buffer in
      for index in buffer.indices { buffer[index] ^= mask[index & 3] }
    }
    return payload
  }

  private static func text(_ payload: [UInt8]) throws(Failure) -> String {
    guard let text = String(bytes: payload, encoding: .utf8) else { throw Failure(code: 1007) }
    return text
  }
}

/// Server frames: never masked, always final.
enum WebSocketFrame {
  static func text(_ text: String) -> Data { frame(0x1, Data(text.utf8)) }
  static func pong(_ payload: Data) -> Data { frame(0xA, payload) }
  static func close(_ code: UInt16) -> Data {
    frame(0x8, Data([UInt8(code >> 8), UInt8(code & 0xFF)]))
  }

  private static func frame(_ opcode: UInt8, _ payload: Data) -> Data {
    var header: [UInt8] = [0x80 | opcode]
    let count = payload.count
    if count < 126 {
      header.append(UInt8(count))
    } else if count <= 0xFFFF {
      header += [126, UInt8(count >> 8), UInt8(count & 0xFF)]
    } else {
      header.append(127)
      header += (0..<8).reversed().map { UInt8((UInt64(count) >> (8 * UInt64($0))) & 0xFF) }
    }
    var frame = Data(header)
    frame.append(payload)
    return frame
  }
}
