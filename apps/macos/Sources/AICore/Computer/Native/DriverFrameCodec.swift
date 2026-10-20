import AIComputerDriverKit
import Foundation

/// The host side of the driver's stdio framing (driver protocol v1): each frame is a 4-byte
/// big-endian length followed by that many bytes of UTF-8 JSON, a `DriverRequestFrame` towards
/// the driver and a `DriverOutgoing` back. The driver exits on a frame it cannot read, so the
/// host never writes one it did not encode here.
public enum DriverFrameCodec {
  /// The largest frame either side accepts; a longer length prefix is a desynchronized stream.
  public static let maxFrameBytes = 64 * 1024 * 1024

  public enum Failure: Error, Equatable, Sendable {
    /// A length prefix of zero or above ``maxFrameBytes``.
    case length(Int)
    /// A frame body that is not a `DriverOutgoing`.
    case body(String)
  }

  /// One request as a frame: its length prefix and JSON body.
  public static func encode(_ frame: DriverRequestFrame) throws -> Data {
    let body = try JSONEncoder().encode(frame)
    var length = UInt32(body.count).bigEndian
    var data = Data(bytes: &length, count: 4)
    data.append(body)
    return data
  }

  /// Splits the bytes the driver writes into frames as they arrive. Not thread safe: one reader
  /// owns it.
  public struct Decoder {
    private var buffer = Data()
    private let decoder = JSONDecoder()

    public init() {}

    /// Appends `data` and returns every frame it completes, in order.
    public mutating func append(_ data: Data) throws(Failure) -> [DriverOutgoing] {
      buffer.append(data)
      var frames: [DriverOutgoing] = []
      while buffer.count >= 4 {
        let start = buffer.startIndex
        let length = buffer[start..<start + 4].reduce(0) { $0 << 8 | Int($1) }
        guard length > 0, length <= maxFrameBytes else { throw .length(length) }
        guard buffer.count >= 4 + length else { break }
        let body = buffer[(start + 4)..<(start + 4 + length)]
        do {
          frames.append(try decoder.decode(DriverOutgoing.self, from: Data(body)))
        } catch {
          throw .body(String(describing: error).prefix(300).description)
        }
        buffer.removeSubrange(start..<(start + 4 + length))
      }
      return frames
    }
  }
}
