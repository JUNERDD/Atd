import Foundation

/// The members of a top-level JSON object as the service's `JSON.parse` sees them: keys
/// decoded (escapes included, so `"type"` is `type`), values as raw bytes, and duplicate
/// keys kept in order. Foundation's parsers collapse duplicates, which would let a frame show
/// Swift one `type` and the service (last key wins) another.
///
/// It only has to be right for text Foundation already accepted as a JSON object; for other
/// input it answers nil.
enum JSONMembers {
  struct Member {
    let key: String
    let value: ArraySlice<UInt8>
  }

  static func scan(_ bytes: [UInt8]) -> [Member]? {
    var scanner = Scanner(bytes: bytes)
    return scanner.object()
  }

  /// Decodes one JSON string token (quotes included) with Foundation's own escape rules.
  static func decodeString(_ token: ArraySlice<UInt8>) -> String? {
    guard token.first == quote else { return nil }
    return try? JSONDecoder().decode(String.self, from: Data(token))
  }

  private static let quote = UInt8(ascii: "\"")

  private struct Scanner {
    let bytes: [UInt8]
    var index = 0

    mutating func object() -> [Member]? {
      skipWhitespace()
      guard take(UInt8(ascii: "{")) else { return nil }
      var members: [Member] = []
      skipWhitespace()
      if take(UInt8(ascii: "}")) { return finish(members) }
      while true {
        skipWhitespace()
        guard let keyToken = string(), let key = JSONMembers.decodeString(keyToken) else {
          return nil
        }
        skipWhitespace()
        guard take(UInt8(ascii: ":")) else { return nil }
        skipWhitespace()
        guard let value = value() else { return nil }
        members.append(Member(key: key, value: value))
        skipWhitespace()
        if take(UInt8(ascii: ",")) { continue }
        guard take(UInt8(ascii: "}")) else { return nil }
        return finish(members)
      }
    }

    private mutating func finish(_ members: [Member]) -> [Member]? {
      skipWhitespace()
      return index == bytes.count ? members : nil
    }

    /// A string token, from its opening quote through its closing quote.
    private mutating func string() -> ArraySlice<UInt8>? {
      let start = index
      guard take(quote) else { return nil }
      while index < bytes.count {
        let byte = bytes[index]
        index += 1
        if byte == UInt8(ascii: "\\") {
          index += 1
        } else if byte == quote {
          return bytes[start..<index]
        }
      }
      return nil
    }

    /// Any value: strings exactly, containers by bracket depth (skipping strings inside),
    /// literals and numbers up to the next delimiter.
    private mutating func value() -> ArraySlice<UInt8>? {
      guard index < bytes.count else { return nil }
      let start = index
      switch bytes[index] {
      case quote:
        return string()
      case UInt8(ascii: "{"), UInt8(ascii: "["):
        var depth = 0
        while index < bytes.count {
          switch bytes[index] {
          case quote:
            guard string() != nil else { return nil }
            continue
          case UInt8(ascii: "{"), UInt8(ascii: "["):
            depth += 1
          case UInt8(ascii: "}"), UInt8(ascii: "]"):
            depth -= 1
          default:
            break
          }
          index += 1
          if depth == 0 { return bytes[start..<index] }
        }
        return nil
      default:
        while index < bytes.count, !isDelimiter(bytes[index]) { index += 1 }
        return index > start ? bytes[start..<index] : nil
      }
    }

    private func isDelimiter(_ byte: UInt8) -> Bool {
      byte == UInt8(ascii: ",") || byte == UInt8(ascii: "}") || isWhitespace(byte)
    }

    private func isWhitespace(_ byte: UInt8) -> Bool {
      byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D
    }

    private mutating func skipWhitespace() {
      while index < bytes.count, isWhitespace(bytes[index]) { index += 1 }
    }

    private mutating func take(_ byte: UInt8) -> Bool {
      guard index < bytes.count, bytes[index] == byte else { return false }
      index += 1
      return true
    }
  }
}
