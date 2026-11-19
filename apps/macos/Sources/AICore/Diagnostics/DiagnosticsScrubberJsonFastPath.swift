import Darwin
import Foundation

/// C-accelerated (`memchr`/`memmem`/`strcasestr`) line splitting, JSON container checks, and
/// provably-clean JSON slice pre-filtering (`B3` Debug `-Onone` & Release `-O` fast path).
///
/// Safety invariant: `isProvablyCleanUnescapedJsonBytes` ONLY returns `true` after `JSONSerialization`
/// has validated the JSON container AND C byte scans have proven the raw UTF-8 slice contains ZERO
/// backslashes (`0x5C` — ruling out all `\uXXXX` unicode escapes, `\/` escaped slashes, `\"` nested
/// JSON strings, and `\n` embedded PEM lines), ZERO forward slashes (`0x2F`), ZERO `@` bytes
/// (`0x40`), ZERO NUL bytes (`0x00`), and ZERO Pass A/C/D secret-key, prefix, or token triggers.
nonisolated enum DiagnosticsScrubberJsonFastPath {
  private static let caseInsensitiveStems: [ContiguousArray<CChar>] = [
    "key", "secret", "token", "pass", "cred", "session", "cookie", "auth", "database",
    "account_id", "bearer", "basic", "digest",
  ].map { makeCString($0) }

  private static let hyphenPrefixes: [[UInt8]] = [
    "sk-", "xox", "xapp-", "-----BEGIN ",
  ].map { Array($0.utf8) }

  private static let underscorePrefixes: [[UInt8]] = [
    "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "ntn_", "hf_",
  ].map { Array($0.utf8) }

  private static let upperAPrefixes: [[UInt8]] = [
    "AKIA", "ASIA", "AIza",
  ].map { Array($0.utf8) }

  private static let jwtBytes = Array("eyJ".utf8)

  private static func makeCString(_ s: String) -> ContiguousArray<CChar> {
    var out = ContiguousArray<CChar>()
    out.reserveCapacity(s.utf8.count + 1)
    for b in s.utf8 { out.append(CChar(bitPattern: b)) }
    out.append(0)
    return out
  }

  /// Splits `data` on `0x0A` (`\n`) using SIMD `memchr`, returning `Range<Int>` byte offsets.
  static func splitLineRanges(_ data: Data) -> [Range<Int>] {
    guard !data.isEmpty else { return [] }
    return data.withUnsafeBytes { raw in
      guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return [] }
      let total = raw.count
      var ranges: [Range<Int>] = []
      ranges.reserveCapacity(max(16, total / 110))
      var start = 0
      while start <= total {
        let rem = total - start
        if rem > 0, let hit = Darwin.memchr(base.advanced(by: start), 0x0A, rem) {
          let nlOffset = base.distance(to: hit.assumingMemoryBound(to: UInt8.self))
          ranges.append(start..<nlOffset)
          start = nlOffset + 1
        } else {
          ranges.append(start..<total)
          break
        }
      }
      return ranges
    }
  }

  /// Verifies that `base[range]` is a single balanced `{...}` or `[...]` container with closed
  /// strings so comma-joined batch JSON array parsing can never splice tokens across lines.
  static func isBalancedTopLevelJsonContainer(
    _ base: UnsafePointer<UInt8>, range: Range<Int>
  ) -> Bool {
    guard range.count >= 2 else { return false }
    var lo = range.lowerBound
    var hi = range.upperBound - 1
    while lo < range.upperBound && (base[lo] == 0x20 || base[lo] == 0x09) { lo += 1 }
    while hi > lo && (base[hi] == 0x20 || base[hi] == 0x09) { hi -= 1 }
    guard
      hi > lo && ((base[lo] == 0x7B && base[hi] == 0x7D) || (base[lo] == 0x5B && base[hi] == 0x5D))
    else { return false }

    let innerCount = hi - lo - 1
    if innerCount == 0 { return true }
    let innerPtr = base.advanced(by: lo + 1)
    if Darwin.memchr(innerPtr, 0x5C, innerCount) == nil
      && Darwin.memchr(innerPtr, 0x7B, innerCount) == nil
      && Darwin.memchr(innerPtr, 0x7D, innerCount) == nil
      && Darwin.memchr(innerPtr, 0x5B, innerCount) == nil
      && Darwin.memchr(innerPtr, 0x5D, innerCount) == nil
    {
      var quotes = 0
      var scanOffset = 0
      while scanOffset < innerCount,
        let qPtr = Darwin.memchr(innerPtr.advanced(by: scanOffset), 0x22, innerCount - scanOffset)
      {
        quotes &+= 1
        scanOffset = innerPtr.distance(to: qPtr.assumingMemoryBound(to: UInt8.self)) + 1
      }
      return (quotes & 1) == 0
    }

    var depth = 0
    var inString = false
    var escaped = false
    var i = lo
    while i <= hi {
      let b = base[i]
      if inString {
        if escaped {
          escaped = false
        } else if b == 0x5C {
          escaped = true
        } else if b == 0x22 {
          inString = false
        }
        i += 1
        continue
      }
      switch b {
      case 0x22:
        inString = true
      case 0x7B, 0x5B:
        depth += 1
      case 0x7D, 0x5D:
        depth -= 1
        if depth <= 0 && i < hi { return false }
      default:
        break
      }
      i += 1
    }
    return !inString && depth == 0
  }

  /// Checks a NUL-terminated buffer `cBase` (`len` UTF-8 bytes followed by `0x00`) using precompiled
  /// C `memchr`/`memmem`/`strcasestr` plus 16-stride Pigeonhole token scanning.
  static func isProvablyCleanNullTerminatedJsonBytes(
    _ ptr: UnsafePointer<UInt8>,
    cString cBase: UnsafePointer<CChar>,
    count len: Int,
    anchors: DiagnosticsScrubber.EnvironmentAnchors
  ) -> Bool {
    guard len >= 2 else { return false }
    if Darwin.memchr(ptr, 0x5C, len) != nil
      || Darwin.memchr(ptr, 0x2F, len) != nil
      || Darwin.memchr(ptr, 0x40, len) != nil
      || Darwin.memchr(ptr, 0x00, len) != nil
    {
      return false
    }

    if Darwin.memchr(ptr, 0x2D, len) != nil && containsAnyBytes(ptr, len: len, in: hyphenPrefixes) {
      return false
    }
    if Darwin.memchr(ptr, 0x5F, len) != nil
      && containsAnyBytes(ptr, len: len, in: underscorePrefixes)
    {
      return false
    }
    if Darwin.memchr(ptr, 0x41, len) != nil && containsAnyBytes(ptr, len: len, in: upperAPrefixes) {
      return false
    }
    if Darwin.memchr(ptr, 0x4A, len) != nil && containsBytes(ptr, len: len, needle: jwtBytes) {
      return false
    }

    for stem in caseInsensitiveStems {
      let matched = stem.withUnsafeBufferPointer { buf in
        guard let nPtr = buf.baseAddress else { return false }
        return Darwin.strcasestr(cBase, nPtr) != nil
      }
      if matched { return false }
    }

    var checkedNonASCII = false
    var hasNonASCII = false
    for pair in anchors.pathReplacements {
      if !checkAnchorAbsent(
        pair, ptr: ptr, cBase: cBase, len: len,
        checkedNonASCII: &checkedNonASCII, hasNonASCII: &hasNonASCII)
      {
        return false
      }
    }
    for pair in anchors.wordReplacements {
      if !checkAnchorAbsent(
        pair, ptr: ptr, cBase: cBase, len: len,
        checkedNonASCII: &checkedNonASCII, hasNonASCII: &hasNonASCII)
      {
        return false
      }
    }

    return !mayHave32ByteMixedTokenRun(ptr, count: len)
  }

  static func isProvablyCleanUnescapedJsonBytes(
    _ base: UnsafePointer<UInt8>,
    range: Range<Int>,
    anchors: DiagnosticsScrubber.EnvironmentAnchors
  ) -> Bool {
    let len = range.count
    guard len >= 2 && len <= DiagnosticsScrubberRules.maxLineBytes else { return false }
    let ptr = base.advanced(by: range.lowerBound)
    if Darwin.memchr(ptr, 0x5C, len) != nil
      || Darwin.memchr(ptr, 0x2F, len) != nil
      || Darwin.memchr(ptr, 0x40, len) != nil
      || Darwin.memchr(ptr, 0x00, len) != nil
    {
      return false
    }
    return withUnsafeTemporaryAllocation(of: CChar.self, capacity: len + 1) { tmp in
      guard let dst = tmp.baseAddress else { return false }
      _ = Darwin.memcpy(dst, ptr, len)
      dst[len] = 0
      let u8Ptr = UnsafeRawPointer(dst).assumingMemoryBound(to: UInt8.self)
      return isProvablyCleanNullTerminatedJsonBytes(
        u8Ptr, cString: dst, count: len, anchors: anchors)
    }
  }

  private static func checkAnchorAbsent(
    _ pair: DiagnosticsScrubber.EnvironmentAnchors.ReplacementPair,
    ptr: UnsafePointer<UInt8>,
    cBase: UnsafePointer<CChar>,
    len: Int,
    checkedNonASCII: inout Bool,
    hasNonASCII: inout Bool
  ) -> Bool {
    if let cNeedle = pair.lowerCString {
      let found = cNeedle.withUnsafeBufferPointer { buf in
        guard let nPtr = buf.baseAddress else { return false }
        return Darwin.strcasestr(cBase, nPtr) != nil
      }
      return !found
    }
    if pair.requiresNonASCII {
      if !checkedNonASCII {
        hasNonASCII = bufferHasNonASCII(ptr, count: len)
        checkedNonASCII = true
      }
      return !hasNonASCII
    }
    return false
  }

  private static func bufferHasNonASCII(_ ptr: UnsafePointer<UInt8>, count: Int) -> Bool {
    var i = 0
    let raw = UnsafeRawPointer(ptr)
    while i + 8 <= count {
      let word = raw.loadUnaligned(fromByteOffset: i, as: UInt64.self)
      if (word & 0x8080_8080_8080_8080) != 0 { return true }
      i += 8
    }
    while i < count {
      if ptr[i] >= 0x80 { return true }
      i += 1
    }
    return false
  }

  /// Pigeonhole 16-stride check: any `[A-Za-z0-9_+=-]{32,}` run covers `(m, m + 16)`.
  private static func mayHave32ByteMixedTokenRun(_ ptr: UnsafePointer<UInt8>, count: Int) -> Bool {
    guard count >= 32 else { return false }
    var m = 15
    while m + 16 < count {
      if isTokenByte(ptr[m]) && isTokenByte(ptr[m + 16]) {
        var left = m
        while left > 0 && isTokenByte(ptr[left - 1]) { left -= 1 }
        var right = m + 17
        while right < count && isTokenByte(ptr[right]) { right += 1 }
        if right - left >= 32 {
          var classes: UInt8 = 0
          var k = left
          while k < right {
            let c = ptr[k]
            if c >= 0x41 && c <= 0x5A {
              classes |= 1
            } else if c >= 0x61 && c <= 0x7A {
              classes |= 2
            } else if c >= 0x30 && c <= 0x39 {
              classes |= 4
            }
            if classes == 7 { return true }
            k += 1
          }
        }
        m = ((right + 15) / 16) * 16
      } else {
        m += 16
      }
    }
    return false
  }

  private static func isTokenByte(_ b: UInt8) -> Bool {
    (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39)
      || b == 0x5F || b == 0x2B || b == 0x3D || b == 0x2D
  }

  private static func containsAnyBytes(
    _ ptr: UnsafePointer<UInt8>, len: Int, in needles: [[UInt8]]
  ) -> Bool {
    for needle in needles where containsBytes(ptr, len: len, needle: needle) { return true }
    return false
  }

  private static func containsBytes(
    _ ptr: UnsafePointer<UInt8>, len: Int, needle: [UInt8]
  ) -> Bool {
    guard len >= needle.count else { return false }
    return needle.withUnsafeBufferPointer { buf in
      guard let nBase = buf.baseAddress else { return false }
      return Darwin.memmem(ptr, len, nBase, buf.count) != nil
    }
  }
}
