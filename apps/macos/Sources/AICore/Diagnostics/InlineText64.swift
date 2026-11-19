import Darwin
import Foundation

/// Fixed 64-byte inline UTF-8 text slot for `< 1 µs` zero-ARC hot-path recording.
///
/// Bytes `0..<63` store scalar-aligned UTF-8 bytes; byte `63` packs metadata:
/// bit 7 (`0x80`) indicates truncation and bits `0..5` (`0x3F`) hold the active UTF-8 byte count
/// (`0...63`). Storing two 4-tuples of `UInt64` guarantees exact 64-byte size, 64-byte stride,
/// 8-byte alignment, and `BitwiseCopyable` value semantics with zero heap allocation or retain
/// traffic.
public struct InlineText64: Sendable, Equatable, BitwiseCopyable, Codable {
  public static let maxPayloadBytes = 63
  private static let lengthMask: UInt8 = 0x3F
  private static let truncatedFlag: UInt8 = 0x80

  public var lo: (UInt64, UInt64, UInt64, UInt64) = (0, 0, 0, 0)
  public var hi: (UInt64, UInt64, UInt64, UInt64) = (0, 0, 0, 0)

  public static let empty = Self()

  @inline(__always)
  public init() {}

  @inline(__always)
  public init(_ source: String?) {
    self.init(truncatingUTF8: source)
  }

  /// Copies up to 63 UTF-8 bytes from `source`, backing up across any split multi-byte sequence
  /// so `0..<utf8Count` always ends on a valid Unicode scalar boundary (never producing `U+FFFD`).
  @inline(__always)
  public init(truncatingUTF8 source: String?) {
    guard let source, !source.isEmpty else { return }
    var raw = source
    raw.withUTF8 { utf8 in
      self.populate(from: utf8)
    }
  }

  @inline(__always)
  public init(truncatingUTF8Bytes utf8: UnsafeBufferPointer<UInt8>) {
    guard !utf8.isEmpty else { return }
    populate(from: utf8)
  }

  @inline(__always)
  private mutating func populate(from utf8: UnsafeBufferPointer<UInt8>) {
    var count = min(utf8.count, Self.maxPayloadBytes)
    let wasTruncated = utf8.count > Self.maxPayloadBytes
    if wasTruncated {
      // Back up if utf8[count] is a UTF-8 continuation byte (10xxxxxx), ensuring the prefix
      // ends right before the split multi-byte scalar's lead byte.
      while count > 0 && (utf8[count] & 0xC0) == 0x80 {
        count -= 1
      }
    }
    withUnsafeMutableBytes(of: &self) { dst in
      if count > 0, let srcBase = utf8.baseAddress, let dstBase = dst.baseAddress {
        memcpy(dstBase, srcBase, count)
      }
      dst[63] = UInt8(count) | (wasTruncated ? Self.truncatedFlag : 0)
    }
  }

  /// Active UTF-8 payload byte length (`0...63`).
  @inline(__always)
  public var utf8Count: Int {
    withUnsafeBytes(of: self) { Int($0[63] & Self.lengthMask) }
  }

  @inline(__always)
  public var isEmpty: Bool {
    utf8Count == 0
  }

  /// True when the original input exceeded 63 UTF-8 bytes and was scalar-truncated.
  @inline(__always)
  public var isTruncated: Bool {
    withUnsafeBytes(of: self) { ($0[63] & Self.truncatedFlag) != 0 }
  }

  /// Decodes the stored UTF-8 payload on slow snapshot/export paths.
  public var stringValue: String {
    withUnsafeBytes(of: self) { raw in
      let count = Int(raw[63] & Self.lengthMask)
      guard count > 0 else { return "" }
      let slice = UnsafeBufferPointer(
        start: raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
        count: count)
      return String(decoding: slice, as: UTF8.self)
    }
  }

  /// Manual `Equatable` comparing metadata byte 63 (length + truncation bit) and only the active
  /// `0..<utf8Count` payload bytes.
  @inline(__always)
  public static func == (lhs: Self, rhs: Self) -> Bool {
    withUnsafeBytes(of: lhs) { left in
      withUnsafeBytes(of: rhs) { right in
        guard left[63] == right[63] else { return false }
        let count = Int(left[63] & Self.lengthMask)
        guard count > 0, let lBase = left.baseAddress, let rBase = right.baseAddress else {
          return true
        }
        return memcmp(lBase, rBase, count) == 0
      }
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    let decoded = try container.decode(String.self)
    self.init(truncatingUTF8: decoded)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(stringValue)
  }
}
