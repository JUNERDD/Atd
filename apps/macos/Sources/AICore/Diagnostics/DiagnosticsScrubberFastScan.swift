import Darwin
import Foundation

/// Single-pass UTF-8 byte scanner and structural fast-path predicates (`B3` & `B5`).
///
/// Every pre-guard in this file is a mathematically necessary condition for its corresponding
/// `NSRegularExpression` rule, eliminating UTF-16 `NSString` bridging and `NSMutableString`
/// allocations on benign strings with zero false-negative risk.
nonisolated enum DiagnosticsScrubberFastScan {
  struct UTF8Features: Sendable {
    let rawFlags: UInt32
    let letterMask: UInt32

    static let flagSlash: UInt32 = 1 << 0
    static let flagBackslash: UInt32 = 1 << 1
    static let flagColon: UInt32 = 1 << 2
    static let flagEquals: UInt32 = 1 << 3
    static let flagAt: UInt32 = 1 << 4
    static let flagDot: UInt32 = 1 << 5
    static let flagColonSlashSlash: UInt32 = 1 << 6
    static let flagJwtPrefix: UInt32 = 1 << 7
    static let flagMayHaveIssuerKey: UInt32 = 1 << 8
    static let flagMixed32TokenRun: UInt32 = 1 << 9
    static let flagNonASCII: UInt32 = 1 << 10
    static let flagSecretKvKeyword: UInt32 = 1 << 11

    var hasSlash: Bool { (rawFlags & Self.flagSlash) != 0 }
    var hasColon: Bool { (rawFlags & Self.flagColon) != 0 }
    var hasAt: Bool { (rawFlags & Self.flagAt) != 0 }
    var hasDot: Bool { (rawFlags & Self.flagDot) != 0 }
    var hasColonSlashSlash: Bool { (rawFlags & Self.flagColonSlashSlash) != 0 }
    var hasJwtPrefix: Bool { (rawFlags & Self.flagJwtPrefix) != 0 }
    var mayHaveIssuerKey: Bool { (rawFlags & Self.flagMayHaveIssuerKey) != 0 }
    var hasMixed32TokenRun: Bool { (rawFlags & Self.flagMixed32TokenRun) != 0 }
    var hasNonASCII: Bool { (rawFlags & Self.flagNonASCII) != 0 }
    var mayHaveSecretKvKeyword: Bool { (rawFlags & Self.flagSecretKvKeyword) != 0 }
    var hasEqualsOrColon: Bool { (rawFlags & (Self.flagEquals | Self.flagColon)) != 0 }
    var hasPathSeparator: Bool { (rawFlags & (Self.flagSlash | Self.flagBackslash)) != 0 }

    func hasAllLetters(_ mask: UInt32) -> Bool {
      (letterMask & mask) == mask
    }
  }

  static let secretKvMasks: [(mask: UInt32, bytes: [UInt8])] = [
    "key", "secret", "token", "pass", "cred", "session", "cookie", "auth", "database",
  ].map { word in
    let bytes = Array(word.utf8)
    return (asciiLetterMask(for: bytes), bytes)
  }

  static func asciiLetterMask(for utf8: some Sequence<UInt8>) -> UInt32 {
    var mask: UInt32 = 0
    for b in utf8 {
      if b >= 0x41 && b <= 0x5A {
        mask |= UInt32(1) << UInt32(b - 0x41)
      } else if b >= 0x61 && b <= 0x7A {
        mask |= UInt32(1) << UInt32(b - 0x61)
      }
    }
    return mask
  }

  /// Scans `text` once in UTF-8 space (`O(N)`, zero heap allocations) to compute rule pre-guards.
  static func scanUTF8(_ text: String) -> UTF8Features {
    var raw = text
    return raw.withUTF8 { buf in
      guard buf.count > 0, let base = buf.baseAddress else {
        return UTF8Features(rawFlags: 0, letterMask: 0)
      }
      return scanBuffer(base, count: buf.count)
    }
  }

  /// Pointer-based single-pass UTF-8 byte scanner shared by `String` and raw `Data` fast paths.
  static func scanBuffer(_ base: UnsafePointer<UInt8>, count: Int) -> UTF8Features {
    guard count > 0 else { return UTF8Features(rawFlags: 0, letterMask: 0) }
    var flags: UInt32 = 0
    var letters: UInt32 = 0
    var runLen = 0
    var runClasses: UInt8 = 0
    var i = 0

    while i < count {
      let b = base[i]
      switch b {
      case 0x2F:  // '/'
        flags |= UTF8Features.flagSlash
        runLen = 0
        runClasses = 0
      case 0x5C:  // '\\'
        flags |= UTF8Features.flagBackslash
        runLen = 0
        runClasses = 0
      case 0x3A:  // ':'
        flags |= UTF8Features.flagColon
        if i + 2 < count && base[i + 1] == 0x2F && base[i + 2] == 0x2F {
          flags |= UTF8Features.flagColonSlashSlash
        }
        runLen = 0
        runClasses = 0
      case 0x3D:  // '='
        flags |= UTF8Features.flagEquals
        runLen += 1
      case 0x40:  // '@'
        flags |= UTF8Features.flagAt
        runLen = 0
        runClasses = 0
      case 0x2E:  // '.'
        flags |= UTF8Features.flagDot
        runLen = 0
        runClasses = 0
      case 0x41...0x5A:  // 'A'...'Z'
        letters |= UInt32(1) << UInt32(b - 0x41)
        runLen += 1
        runClasses |= 1
        if b == 0x41 && i + 3 < count {
          let b1 = base[i + 1]
          let b2 = base[i + 2]
          let b3 = base[i + 3]
          if (b1 == 0x4B && b2 == 0x49 && b3 == 0x41)
            || (b1 == 0x53 && b2 == 0x49 && b3 == 0x41)
            || (b1 == 0x49 && b2 == 0x7A && b3 == 0x61)
          {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        }
      case 0x61...0x7A:  // 'a'...'z'
        letters |= UInt32(1) << UInt32(b - 0x61)
        runLen += 1
        runClasses |= 2
        switch b {
        case 0x65:  // 'e' -> "eyJ"
          if i + 2 < count && base[i + 1] == 0x79 && base[i + 2] == 0x4A {
            flags |= UTF8Features.flagJwtPrefix
          }
        case 0x73:  // 's' -> "sk-"
          if i + 2 < count && base[i + 1] == 0x6B && base[i + 2] == 0x2D {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        case 0x67:  // 'g' -> "gh?_" or "gith"
          if i + 3 < count
            && ((base[i + 1] == 0x68 && base[i + 3] == 0x5F)
              || (base[i + 1] == 0x69 && base[i + 2] == 0x74 && base[i + 3] == 0x68))
          {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        case 0x78:  // 'x' -> "xox" or "xapp"
          if i + 3 < count
            && ((base[i + 1] == 0x6F && base[i + 2] == 0x78)
              || (base[i + 1] == 0x61 && base[i + 2] == 0x70 && base[i + 3] == 0x70))
          {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        case 0x6E:  // 'n' -> "ntn_"
          if i + 3 < count && base[i + 1] == 0x74 && base[i + 2] == 0x6E && base[i + 3] == 0x5F {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        case 0x68:  // 'h' -> "hf_"
          if i + 2 < count && base[i + 1] == 0x66 && base[i + 2] == 0x5F {
            flags |= UTF8Features.flagMayHaveIssuerKey
          }
        default:
          break
        }
      case 0x30...0x39:  // '0'...'9'
        runLen += 1
        runClasses |= 4
      case 0x5F, 0x2B, 0x2D:  // '_', '+', '-'
        runLen += 1
      default:
        if b >= 0x80 { flags |= UTF8Features.flagNonASCII }
        runLen = 0
        runClasses = 0
      }
      if runLen >= 32 && runClasses == 7 {
        flags |= UTF8Features.flagMixed32TokenRun
      }
      i += 1
    }

    if (flags & (UTF8Features.flagEquals | UTF8Features.flagColon)) != 0 {
      for entry in secretKvMasks where (letters & entry.mask) == entry.mask {
        if containsCaseInsensitiveASCII(base: base, count: count, lowerNeedle: entry.bytes) {
          flags |= UTF8Features.flagSecretKvKeyword
          break
        }
      }
    }
    return UTF8Features(rawFlags: flags, letterMask: letters)
  }

  /// Zero-allocation SIMD `memmem` ASCII substring check in UTF-8 bytes.
  static func containsASCII(_ text: String, _ needle: StaticString) -> Bool {
    let nLen = needle.utf8CodeUnitCount
    guard nLen > 0 else { return true }
    var raw = text
    return raw.withUTF8 { hay in
      guard hay.count >= nLen, let hBase = hay.baseAddress else { return false }
      return needle.withUTF8Buffer { ndl in
        guard let nBase = ndl.baseAddress else { return false }
        return Darwin.memmem(hBase, hay.count, nBase, nLen) != nil
      }
    }
  }

  /// Zero-allocation case-insensitive ASCII substring check (`lowerNeedle` must be lowercased ASCII).
  static func containsCaseInsensitiveASCII(_ text: String, lowerNeedle: [UInt8]) -> Bool {
    var raw = text
    return raw.withUTF8 { hay in
      guard let hBase = hay.baseAddress else { return lowerNeedle.isEmpty }
      return containsCaseInsensitiveASCII(base: hBase, count: hay.count, lowerNeedle: lowerNeedle)
    }
  }

  static func containsCaseInsensitiveASCII(
    base hBase: UnsafePointer<UInt8>, count: Int, lowerNeedle: [UInt8]
  ) -> Bool {
    let nLen = lowerNeedle.count
    guard nLen > 0 else { return true }
    guard count >= nLen else { return false }
    return lowerNeedle.withUnsafeBufferPointer { ndl in
      guard let nBase = ndl.baseAddress else { return false }
      let first = nBase[0]
      let limit = count - nLen
      var i = 0
      while i <= limit {
        let b0 = hBase[i]
        if ((b0 >= 0x41 && b0 <= 0x5A) ? (b0 | 0x20) : b0) == first {
          var j = 1
          while j < nLen {
            let bj = hBase[i + j]
            if ((bj >= 0x41 && bj <= 0x5A) ? (bj | 0x20) : bj) != nBase[j] { break }
            j += 1
          }
          if j == nLen { return true }
        }
        i += 1
      }
      return false
    }
  }

  static func lowerASCII(_ byte: UInt8) -> UInt8 {
    (byte >= 0x41 && byte <= 0x5A) ? (byte | 0x20) : byte
  }

  /// Skips the 5-pass scrubber on structural JSON values (`ts`, `level`, `schemaVersion`,
  /// `SUPublicEDKey`) when their bytes match known public/enum formats.
  static func isSafeStructuralLeaf(key: String, value: String) -> Bool {
    switch key {
    case "level":
      switch value {
      case "debug", "info", "warn", "error", "fault", "trace", "fatal":
        return true
      default:
        return false
      }
    case "ts":
      var raw = value
      return raw.withUTF8 { buf in
        guard buf.count >= 10 && buf.count <= 36, let base = buf.baseAddress else { return false }
        guard base[0] >= 0x30 && base[0] <= 0x39 && base[1] >= 0x30 && base[1] <= 0x39 else {
          return false
        }
        var i = 0
        while i < buf.count {
          let b = base[i]
          let ok =
            (b >= 0x30 && b <= 0x39) || b == 0x2D || b == 0x3A || b == 0x2E || b == 0x2B
            || b == 0x54 || b == 0x5A || b == 0x20
          if !ok { return false }
          i += 1
        }
        return true
      }
    case "schemaVersion":
      var raw = value
      return raw.withUTF8 { buf in
        guard buf.count >= 1 && buf.count <= 8 else { return false }
        return buf.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2E }
      }
    case "SUPublicEDKey":
      var raw = value
      return raw.withUTF8 { buf in
        guard buf.count >= 16 && buf.count <= 88 else { return false }
        return buf.allSatisfy {
          ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x61 && $0 <= 0x7A)
            || ($0 >= 0x30 && $0 <= 0x39) || $0 == 0x2B || $0 == 0x2F || $0 == 0x3D
        }
      }
    default:
      return false
    }
  }

  static func mayBeEmbeddedJsonObject(_ text: String) -> Bool {
    var raw = text
    return raw.withUTF8 { buf in
      guard let base = buf.baseAddress else { return false }
      var lo = 0
      while lo < buf.count && isASCIIWhitespace(base[lo]) { lo += 1 }
      guard lo < buf.count && base[lo] == 0x7B else { return false }
      var hi = buf.count - 1
      while hi > lo && isASCIIWhitespace(base[hi]) { hi -= 1 }
      return base[hi] == 0x7D
    }
  }

  private static func isASCIIWhitespace(_ b: UInt8) -> Bool {
    b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D
  }

  static func foldPemLine(_ line: String, remainingSkip: inout Int, hits: inout Int) -> String? {
    if remainingSkip > 0 {
      remainingSkip = containsASCII(line, "-----END ") ? 0 : remainingSkip - 1
      return nil
    }
    guard
      containsASCII(line, "-----BEGIN ")
        && (containsASCII(line, "PRIVATE KEY")
          || containsASCII(line, "SECRET")
          || containsASCII(line, "CERTIFICATE"))
    else { return nil }
    hits += 1
    if !containsASCII(line, "-----END ") { remainingSkip = 128 }
    return "-----REDACTED PEM BLOCK-----"
  }
}
