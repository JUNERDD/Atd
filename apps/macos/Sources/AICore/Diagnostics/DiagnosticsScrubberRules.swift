import Foundation

/// Regex rules, Pass A/B/D pipeline, high-entropy token classifier, and UTF-8 scalar truncation.
nonisolated enum DiagnosticsScrubberRules {
  static let maxLineBytes = 4_096
  static let truncationSuffix = "…[truncated:4KiB]"  // 19 UTF-8 bytes
  static let maxPrefixBytes = 4_077  // 4077 + 19 == 4096

  static let reservedWords: Set<String> = [
    "root", "daemon", "nobody", "user", "admin", "staff", "local", "localhost",
    "mac", "pro", "air", "max", "mini", "dev", "app", "main", "node", "test",
    "true", "false", "null", "info", "warn", "error", "host", "atd", "redacted",
  ]

  static let secretJsonKeyRegex = compile(
    #"(?i)^(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|token|password|passwd|credential|encryptedCredential|authorization|cookie|set-cookie|x-api-key|proxy-authorization)$"#
  )

  private static let homePathRegex = compile(#"/(?:Users|home)/([A-Za-z0-9_.-]+)"#)
  private static let darwinTranslocatedRegex = compile(
    #"(?:/private)?/var/folders/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/AppTranslocation/[A-Za-z0-9-]+"#
  )
  private static let darwinTmpRegex = compile(
    #"(?:/private)?/var/folders/(?!<tmp>)[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?"#
  )
  private static let volumesRegex = compile(#"/Volumes/([^/\s"'`\\,;:<>)\]}]+)"#)

  private static let authSchemeRegex = compile(
    #"(?i)\b(Bearer|Basic|Digest)\s+(?!<redacted)([A-Za-z0-9._~+/=-]{8,})"#
  )
  private static let wsSubprotoRegex = compile(#"\bai\.auth\.(?!<redacted)[A-Za-z0-9_-]+"#)
  private static let issuerKeysRegex = compile(
    #"(?<![A-Za-z0-9_-])(?:sk-(?:ant-api\d*-|or-v1-|proj-|svcacct-)?[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|ntn_[A-Za-z0-9_]{10,}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{20,})(?![A-Za-z0-9_-])"#
  )
  private static let jwtRegex = compile(
    #"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])"#
  )
  private static let plainKvRegex = compile(
    #"(?i)\b(?!SUPublicEDKey\b)([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|credential|database_url|private_key|cookie|set-cookie|x-api-key|authorization|proxy-authorization)[A-Za-z0-9_-]*)(\\?["'])?(\s*[=:]\s*)(?!\s*(?:Bearer|Basic|Digest)\s+<redacted-token>|\\?["']?<redacted)(?:(\\?["'])([^"\\]{1,512})(\\?["'])|([^\s"'\\,;<)\]}]{4,512}))"#
  )
  private static let emailRegex = compile(
    #"(?<![A-Za-z0-9._%+-/])([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})(?![A-Za-z0-9._%+-])"#
  )
  private static let randomTokenRegex = compile(
    #"(?<![A-Za-z0-9_-])[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_-])"#
  )

  private static func compile(_ pattern: String) -> NSRegularExpression {
    try! NSRegularExpression(pattern: pattern)
  }

  /// Scalar-aligned UTF-8 line truncation (`<= 4,077 B` + `"…[truncated:4KiB]"` = `<= 4,096 B`).
  static func truncateLine4KiB(_ text: String) -> String {
    guard text.utf8.count > maxLineBytes else { return text }
    return truncateUTF8(text, maxPrefixBytes: maxPrefixBytes, suffix: truncationSuffix)
  }

  static func truncateUTF8(_ text: String, maxPrefixBytes: Int, suffix: String) -> String {
    let maxTotal = maxPrefixBytes + suffix.utf8.count
    guard text.utf8.count > maxTotal else { return text }
    var raw = text
    return raw.withUTF8 { utf8 in
      var cut = min(utf8.count, max(0, maxPrefixBytes))
      while cut > 0 && (utf8[cut] & 0xC0) == 0x80 {
        cut -= 1
      }
      let slice = UnsafeBufferPointer(start: utf8.baseAddress, count: cut)
      return String(decoding: slice, as: UTF8.self) + suffix
    }
  }

  /// Executes `Pass C -> Pass A -> Pass B -> Pass D -> Pass E` on a single text line.
  static func scrubSingleLine(
    _ input: String, anchors: DiagnosticsScrubber.EnvironmentAnchors, enforce4KiBCap: Bool
  ) -> (text: String, hits: Int) {
    var text = enforce4KiBCap ? truncateLine4KiB(input) : input
    var hits = 0
    (text, hits) = DiagnosticsScrubberURLSanitizer.apply(text, priorHits: hits)
    (text, hits) = applyPassA(text, anchors: anchors, priorHits: hits)
    (text, hits) = applyPassB(text, priorHits: hits)
    (text, hits) = applyPassD(text, priorHits: hits)
    if enforce4KiBCap && text.utf8.count > maxLineBytes {
      text = truncateLine4KiB(text)
    }
    return (text, hits)
  }

  static func replace(
    _ regex: NSRegularExpression, in text: String, with template: String, hits: inout Int
  ) -> String {
    let mutable = NSMutableString(string: text)
    let count = regex.replaceMatches(
      in: mutable, range: NSRange(location: 0, length: mutable.length), withTemplate: template)
    hits += count
    return count > 0 ? (mutable as String) : text
  }

  private static func applyPassA(
    _ input: String, anchors: DiagnosticsScrubber.EnvironmentAnchors, priorHits: Int
  ) -> (String, Int) {
    var text = input
    var hits = priorHits
    for pair in anchors.pathReplacements {
      let regex = compile(
        NSRegularExpression.escapedPattern(for: pair.source) + #"(?=$|/|\\|\s|["'`,;:)\]}])"#)
      text = replace(regex, in: text, with: pair.target, hits: &hits)
    }
    for pair in anchors.wordReplacements {
      let regex = compile(
        #"(?<![A-Za-z0-9<])"# + NSRegularExpression.escapedPattern(for: pair.source)
          + #"(?![A-Za-z0-9>])"#)
      text = replace(regex, in: text, with: pair.target, hits: &hits)
    }
    return (text, hits)
  }

  private static func applyPassB(_ input: String, priorHits: Int) -> (String, Int) {
    var text = input
    var hits = priorHits
    text = replace(homePathRegex, in: text, with: "/Users/<user>", hits: &hits)
    text = replace(
      darwinTranslocatedRegex, in: text,
      with: "/private/var/folders/<tmp>/AppTranslocation/<uuid>", hits: &hits)
    text = replace(darwinTmpRegex, in: text, with: "/private/var/folders/<tmp>", hits: &hits)
    text = replace(volumesRegex, in: text, with: "/Volumes/<volume>", hits: &hits)
    return (text, hits)
  }

  private static func applyPassD(_ input: String, priorHits: Int) -> (String, Int) {
    var text = input
    var hits = priorHits
    text = replace(authSchemeRegex, in: text, with: "$1 <redacted-token>", hits: &hits)
    text = replace(wsSubprotoRegex, in: text, with: "ai.auth.<redacted-token>", hits: &hits)
    text = replace(issuerKeysRegex, in: text, with: "<redacted:api-key>", hits: &hits)
    text = replace(jwtRegex, in: text, with: "<redacted:jwt>", hits: &hits)

    let kvNs = text as NSString
    let kvMatches = plainKvRegex.matches(in: text, range: NSRange(location: 0, length: kvNs.length))
    if !kvMatches.isEmpty {
      let out = NSMutableString(string: text)
      for match in kvMatches.reversed() {
        let key = kvNs.substring(with: match.range(at: 1))
        let keyQuote =
          match.range(at: 2).location != NSNotFound ? kvNs.substring(with: match.range(at: 2)) : ""
        let sep = kvNs.substring(with: match.range(at: 3))
        let openQ =
          match.range(at: 4).location != NSNotFound ? kvNs.substring(with: match.range(at: 4)) : ""
        let closeQ =
          match.range(at: 6).location != NSNotFound ? kvNs.substring(with: match.range(at: 6)) : ""
        out.replaceCharacters(
          in: match.range, with: "\(key)\(keyQuote)\(sep)\(openQ)<redacted>\(closeQ)")
        hits += 1
      }
      text = out as String
    }

    text = replace(emailRegex, in: text, with: "<redacted:email>", hits: &hits)

    let tokNs = text as NSString
    let tokMatches = randomTokenRegex.matches(
      in: text, range: NSRange(location: 0, length: tokNs.length))
    if !tokMatches.isEmpty {
      let out = NSMutableString(string: text)
      for match in tokMatches.reversed() {
        let candidate = tokNs.substring(with: match.range)
        if isHighEntropyRandomToken(candidate[...]) {
          out.replaceCharacters(in: match.range, with: "<redacted:high-entropy>")
          hits += 1
        }
      }
      text = out as String
    }
    return (text, hits)
  }

  /// Mirrors `SensitiveText` high-entropy token classifier (`>= 32` chars, mixed upper/lower/digit,
  /// `>= 3.5` bits/char, skipping hex SHA digests and UUIDs).
  static func isHighEntropyRandomToken(_ token: Substring) -> Bool {
    guard !token.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return false }
    let classes = token.compactMap { ch -> Int? in
      if ch.isUppercase { return 0 }
      if ch.isLowercase { return 1 }
      return ch.isNumber ? 2 : nil
    }
    guard Set(classes).count == 3 else { return false }
    let digits = classes.indices.filter { classes[$0] == 2 }
    guard digits.count >= max(3, (classes.count + 9) / 10),
      let first = digits.first, let last = digits.last, last - first >= classes.count / 3
    else { return false }
    let switches = zip(classes, classes.dropFirst()).filter { $0 != $1 }.count
    guard Double(switches) >= 0.35 * Double(classes.count - 1) else { return false }
    var counts: [Character: Int] = [:]
    for ch in token { counts[ch, default: 0] += 1 }
    let length = Double(token.count)
    let entropy = counts.values.reduce(0.0) { acc, count in
      let p = Double(count) / length
      return acc - p * log2(p)
    }
    return entropy >= 3.5
  }
}
