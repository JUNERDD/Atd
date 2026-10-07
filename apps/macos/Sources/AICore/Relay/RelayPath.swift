import Foundation

/// Why a scheme-handler URL was refused before any routing. Every case answers the page with an
/// error and never reaches a file or the service.
public enum RelayRequestError: Error, Equatable, Sendable {
  /// Not the handler's own origin (`ai-app://renderer`, or `ai-userapp://<appId>` for a user
  /// app's handler), or it carries a user, password or port.
  case wrongOrigin
  /// The path does not start with `/`.
  case notAbsolute
  /// The raw path is longer than ``RelayPath/maxLength`` bytes.
  case tooLong
  /// A raw character outside RFC 3986 `pchar`: backslash, space, control, non-ASCII, `?`, `#`…
  case forbiddenCharacter
  /// A `%` not followed by two hex digits.
  case malformedEscape
  /// An escape that decodes to `/`, `\`, `%` or a control character. Refusing a decoded `%`
  /// is what defeats double decoding (`%252e`, `%252F`).
  case forbiddenEscape
  /// A segment whose decoded bytes are not UTF-8.
  case invalidUTF8
  /// `//`, or a trailing slash anywhere but the root path.
  case emptySegment
  /// A `.` or `..` segment, spelled literally or percent-encoded.
  case dotSegment
  /// The query contains a character outside RFC 3986 `query`.
  case forbiddenQuery
}

/// A path that passed ``RelayPath/normalize(_:)``: decoded segments with no separators, dot
/// segments, escapes of separators or control characters.
public struct NormalizedPath: Hashable, Sendable, CustomStringConvertible {
  /// Decoded segments; empty for the root path `/`.
  public let segments: [String]

  /// The canonical encoding forwarded upstream: every byte outside RFC 3986 `unreserved` is
  /// percent-encoded, so the service decodes exactly the segments that were matched.
  public var encoded: String {
    "/" + segments.map(RelayPath.encodeSegment).joined(separator: "/")
  }

  public var description: String { encoded }
}

/// Where a renderer URL goes once it is normalized.
public enum RelayTarget: Equatable, Sendable {
  /// `/v1/...`: checked against the route manifest, then forwarded with its raw query.
  case api(NormalizedPath, query: String?)
  /// Anything else: a file of the renderer bundle. The query is ignored.
  case asset(NormalizedPath)
}

/// The one normalization step shared by static-file serving and service forwarding, for the
/// renderer's handler and the user apps' handler alike.
public enum RelayPath {
  public static let scheme = "ai-app"
  public static let host = "renderer"
  public static let maxLength = 4096

  /// Validates the origin of an `ai-app://renderer` URL and routes its path.
  public static func classify(_ url: URL) throws(RelayRequestError) -> RelayTarget {
    let path = try normalizedPath(of: url, scheme: scheme, host: host)
    guard path.segments.first == "v1" else { return .asset(path) }
    return .api(path, query: try query(of: url))
  }

  /// The normalized path of a URL that must belong to exactly `scheme://host`: no user, password
  /// or port, and the host compared percent-encoded and case-sensitively, so no spelling of
  /// another origin passes. Each handler routes the result itself.
  public static func normalizedPath(
    of url: URL, scheme expectedScheme: String, host expectedHost: String
  ) throws(RelayRequestError) -> NormalizedPath {
    guard url.scheme == expectedScheme, url.host(percentEncoded: true) == expectedHost,
      url.user == nil, url.password == nil, url.port == nil
    else { throw .wrongOrigin }
    return try normalize(url.path(percentEncoded: true))
  }

  /// The raw query of a URL that is forwarded to the service, or nil when it has none.
  public static func query(of url: URL) throws(RelayRequestError) -> String? {
    let query = url.query(percentEncoded: true)
    if let query, !query.utf8.allSatisfy(isQueryByte) { throw .forbiddenQuery }
    return query
  }

  /// Normalizes a raw, percent-encoded absolute path. Each segment is decoded exactly once;
  /// anything that could mean something different after a second decode or to a file system
  /// is refused rather than repaired.
  public static func normalize(_ raw: String) throws(RelayRequestError) -> NormalizedPath {
    let bytes = Array(raw.utf8)
    guard bytes.count <= maxLength else { throw .tooLong }
    guard bytes.first == slash else { throw .notAbsolute }
    if bytes.count == 1 { return NormalizedPath(segments: []) }
    var segments: [String] = []
    for raw in bytes.dropFirst().split(separator: slash, omittingEmptySubsequences: false) {
      segments.append(try decodeSegment(raw))
    }
    return NormalizedPath(segments: segments)
  }

  /// Percent-encodes one path segment: every byte outside RFC 3986 `unreserved`.
  public static func encodeSegment(_ segment: String) -> String {
    var encoded = ""
    for byte in segment.utf8 {
      if isUnreserved(byte) {
        encoded.unicodeScalars.append(Unicode.Scalar(byte))
      } else {
        encoded += "%" + hexDigits[Int(byte >> 4)] + hexDigits[Int(byte & 0x0F)]
      }
    }
    return encoded
  }

  private static func decodeSegment(_ raw: ArraySlice<UInt8>) throws(RelayRequestError) -> String {
    guard !raw.isEmpty else { throw .emptySegment }
    var decoded: [UInt8] = []
    decoded.reserveCapacity(raw.count)
    var index = raw.startIndex
    while index < raw.endIndex {
      let byte = raw[index]
      if byte == percent {
        guard index + 2 < raw.endIndex, let high = hexValue(raw[index + 1]),
          let low = hexValue(raw[index + 2])
        else { throw .malformedEscape }
        let value = high << 4 | low
        if value == slash || value == backslash || value == percent || isControl(value) {
          throw .forbiddenEscape
        }
        decoded.append(value)
        index += 3
      } else {
        guard isPathByte(byte) else { throw .forbiddenCharacter }
        decoded.append(byte)
        index += 1
      }
    }
    guard let segment = String(validating: decoded, as: UTF8.self) else { throw .invalidUTF8 }
    if segment == "." || segment == ".." { throw .dotSegment }
    return segment
  }

  private static let slash = UInt8(ascii: "/")
  private static let backslash = UInt8(ascii: "\\")
  private static let percent = UInt8(ascii: "%")
  private static let hexDigits = Array("0123456789ABCDEF").map(String.init)

  private static func hexValue(_ byte: UInt8) -> UInt8? {
    switch byte {
    case UInt8(ascii: "0")...UInt8(ascii: "9"): byte - UInt8(ascii: "0")
    case UInt8(ascii: "a")...UInt8(ascii: "f"): byte - UInt8(ascii: "a") + 10
    case UInt8(ascii: "A")...UInt8(ascii: "F"): byte - UInt8(ascii: "A") + 10
    default: nil
    }
  }

  private static func isControl(_ byte: UInt8) -> Bool { byte < 0x20 || byte == 0x7F }

  /// RFC 3986 `unreserved`.
  private static func isUnreserved(_ byte: UInt8) -> Bool {
    switch byte {
    case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"),
      UInt8(ascii: "0")...UInt8(ascii: "9"):
      true
    default: "-._~".utf8.contains(byte)
    }
  }

  /// RFC 3986 `pchar` without `%`, which is handled as an escape.
  private static func isPathByte(_ byte: UInt8) -> Bool {
    isUnreserved(byte) || "!$&'()*+,;=:@".utf8.contains(byte)
  }

  /// RFC 3986 `query`, with `%` allowed as-is: the service parses the query, the relay only
  /// keeps characters out that no URL would carry.
  private static func isQueryByte(_ byte: UInt8) -> Bool {
    isPathByte(byte) || "/?%".utf8.contains(byte)
  }
}
