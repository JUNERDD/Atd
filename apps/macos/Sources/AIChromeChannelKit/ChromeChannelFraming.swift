import Foundation

/// The channel's framing, the same on both legs (Chrome's stdio to the native host, the host's
/// unix socket to the shell): a 4-byte little-endian length, then that many bytes of UTF-8 JSON,
/// one object per frame. Chrome reads at most ``maxToChrome`` bytes per message towards the
/// extension, so the shell splits larger frames into `chunk` frames (``chunks(of:id:)``), which the
/// extension reassembles in order.
public enum ChromeChannelFraming {
  /// The largest frame Chrome accepts from a native host (1 MB).
  public static let maxToChrome = 1_048_576
  /// The largest frame the extension may send (Chrome's own limit towards a host is 64 MiB).
  public static let maxFromChrome = 64 * 1024 * 1024
  /// A serialized frame above this is sent as chunks.
  public static let chunkThreshold = 900_000
  /// The UTF-8 bytes of the serialized frame one chunk carries. Embedding the slice as a JSON
  /// string escapes at most every `"` and `\` (serialized JSON holds no raw control characters),
  /// which at most doubles it, so a chunk frame stays below ``maxToChrome``.
  public static let chunkSliceBytes = 400_000

  public enum Failure: Error, Equatable, Sendable {
    /// A length prefix of zero or above the reader's limit: the stream is desynchronized.
    case length(Int)
  }

  /// `body` with its length prefix.
  public static func frame(_ body: Data) -> Data {
    var length = UInt32(body.count).littleEndian
    var data = Data(bytes: &length, count: 4)
    data.append(body)
    return data
  }

  /// The frames that carry `serialized` (one frame's JSON) towards Chrome: the frame itself when
  /// it fits under ``chunkThreshold``, else consecutive `chunk` frames whose `data` slices,
  /// concatenated, are the serialized frame again. Slices never split a Unicode scalar.
  public static func chunks(of serialized: Data, id: String) throws -> [Data] {
    guard serialized.count > chunkThreshold else { return [serialized] }
    let text = String(decoding: serialized, as: UTF8.self)
    var slices: [String] = []
    var current = String.UnicodeScalarView()
    var bytes = 0
    for scalar in text.unicodeScalars {
      let size = String(scalar).utf8.count
      if bytes + size > chunkSliceBytes {
        slices.append(String(current))
        current = String.UnicodeScalarView()
        bytes = 0
      }
      current.append(scalar)
      bytes += size
    }
    if !current.isEmpty { slices.append(String(current)) }
    return try slices.enumerated().map { seq, data in
      try ChromeChannelCoding.encode(
        ChromeChunkFrame(id: id, seq: seq, last: seq == slices.count - 1, data: data))
    }
  }

  /// Splits a byte stream into frame bodies as the bytes arrive. Not thread safe: one reader owns
  /// it.
  public struct Reader: Sendable {
    private var buffer = Data()
    private let limit: Int

    public init(limit: Int) { self.limit = limit }

    /// Appends `data` and returns every frame body it completes, in order.
    public mutating func append(_ data: Data) throws(Failure) -> [Data] {
      buffer.append(data)
      var bodies: [Data] = []
      while buffer.count >= 4 {
        let start = buffer.startIndex
        let length = (0..<4).reduce(0) { $0 | Int(buffer[start + $1]) << (8 * $1) }
        guard length > 0, length <= limit else { throw .length(length) }
        guard buffer.count >= 4 + length else { break }
        bodies.append(Data(buffer[(start + 4)..<(start + 4 + length)]))
        buffer.removeSubrange(start..<(start + 4 + length))
      }
      return bodies
    }
  }
}

/// `{v:1, t:'chunk', id, seq, last, data}`: one slice of a frame too large for one message to
/// Chrome. Only the shell writes them.
public struct ChromeChunkFrame: Encodable, Equatable, Sendable {
  public let id: String
  public let seq: Int
  public let last: Bool
  public let data: String

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(ChromeChannelProtocol.version, forKey: .v)
    try container.encode("chunk", forKey: .t)
    try container.encode(id, forKey: .id)
    try container.encode(seq, forKey: .seq)
    try container.encode(last, forKey: .last)
    try container.encode(data, forKey: .data)
  }

  private enum CodingKeys: String, CodingKey { case v, t, id, seq, last, data }
}
