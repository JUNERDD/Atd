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

  private static let bearerBytes = Array("bearer".utf8)
  private static let bearerMask = DiagnosticsScrubberFastScan.asciiLetterMask(for: bearerBytes)
  private static let basicBytes = Array("basic".utf8)
  private static let basicMask = DiagnosticsScrubberFastScan.asciiLetterMask(for: basicBytes)
  private static let digestBytes = Array("digest".utf8)
  private static let digestMask = DiagnosticsScrubberFastScan.asciiLetterMask(for: digestBytes)
  private static let cookieBytes = Array("cookie".utf8)
  private static let cookieMask = DiagnosticsScrubberFastScan.asciiLetterMask(for: cookieBytes)

  /// Matches standalone & compound secret JSON/KV key names while excluding boolean `has*`/`is*`
  /// flags, diagnostic count/issue/status/state metrics, Sparkle `SUPublicEDKey`, and LLM token
  /// usage counters (`inputTokens`, `outputTokens`, `totalTokens`, `maxTokens`, `cacheReadTokens`,
  /// `tokenCount`) (`B5`).
  static let secretJsonKeyRegex = compile(
    #"(?i)^(?-i:(?!(?:has|HAS|is|IS)[_-]|(?:has|is)[A-Z]))(?!SUPublicEDKey$)(?!.*(?:count|issue|issues|status|state|limit|budget|enabled|supported|available)s?$)(?!(?:input|output|total|max|min|prompt|completion|cache[_-]?read|cache[_-]?write|reasoning|context)[_-]?tokens?$)(?!.*tokens$)(?:[A-Za-z0-9_-]*(?:(?:api[_-]?key|private[_-]?key|secret|password|passwd|credential|session[_-]?id|database[_-]?url|x[_-]?api[_-]?key|proxy[_-]?authorization|cookie|set[_-]?cookie)[A-Za-z0-9_-]*|token(?:[_-]?(?:value|val|str|string|id))?)|authorization)$"#
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
  private static let cookieHeaderRegex = compile(
    #"(?i)\b(set-cookie|cookie)([ \t]*:[ \t]*)(?!\\?["'])(?!<redacted)((?:[^\\\r\n"'\s]|\\[^rRnN"'\r\n])(?:[^\\\r\n"']|\\[^rRnN"'\r\n])*)"#
  )
  private static let plainKvRegex = compile(
    #"(?i)(?<![A-Za-z0-9_-])(?!-*SUPublicEDKey(?![A-Za-z0-9_-]))([A-Za-z0-9_-]*(?:api[_-]?key|private[_-]?key|secret|token|password|passwd|credential|session[_-]?id|database[_-]?url|cookie|set[_-]?cookie|x[_-]?api[_-]?key|authorization|proxy[_-]?authorization)[A-Za-z0-9_-]*)(\\?["'])?([ \t]*[=:][ \t]*)(?![ \t]*(?:Bearer|Basic|Digest)\s+<redacted-token>|\\?["']?<redacted)(?:(\\")((?:[^"\\]|\\\\\\"|\\\\(?!\\")|\\[^"\\]){1,512})(\\")|(")((?:[^"\\]|\\[^\r\n]){1,512})(")|(\\')((?:[^'\\]|\\\\\\'|\\\\(?!\\')|\\[^'\\]){1,512})(\\')|(')((?:[^'\\]|\\[^\r\n]){1,512})(')|((?:[^\s"'\\,;<)\]}]|\\[^rRnN"' \t\r\n]){4,512}))"#
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

  /// Fast-path secret JSON/KV key check avoiding regex evaluation on common structural keys.
  static func isSecretKeyName(_ rawKey: String) -> Bool {
    let utf8Count = rawKey.utf8.count
    guard utf8Count >= 5 && utf8Count <= 128 else { return false }
    switch rawKey {
    case "level", "status", "phase", "outcome", "schemaVersion", "reasonCode", "durationMs",
      "dropped", "droppedCount", "capacity", "entries", "lines", "metrics", "summary",
      "errorCode", "errorCategory", "capturedAt", "generatedAt", "startedAt", "createdAt",
      "hasCredential", "credentialIssue", "providerCredentialIssueCount",
      "launchApprovalKeyState", "SUPublicEDKey":
      return false
    default:
      break
    }
    let trimmed: String
    if rawKey.utf8.first == 0x2D || rawKey.utf8.first == 0x5F || rawKey.utf8.last == 0x2D
      || rawKey.utf8.last == 0x5F
    {
      trimmed = rawKey.trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
      guard trimmed.utf8.count >= 5 else { return false }
    } else {
      trimmed = rawKey
    }
    let range = NSRange(trimmed.startIndex..., in: trimmed)
    return secretJsonKeyRegex.firstMatch(in: trimmed, options: [], range: range) != nil
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
    guard !text.isEmpty else { return (text, 0) }
    var features = DiagnosticsScrubberFastScan.scanUTF8(text)
    var hits = 0

    let beforeC = hits
    (text, hits) = DiagnosticsScrubberURLSanitizer.apply(text, features: features, priorHits: hits)
    if hits != beforeC { features = DiagnosticsScrubberFastScan.scanUTF8(text) }

    let beforeA = hits
    (text, hits) = applyPassA(text, anchors: anchors, features: features, priorHits: hits)
    if hits != beforeA { features = DiagnosticsScrubberFastScan.scanUTF8(text) }

    let beforeB = hits
    (text, hits) = applyPassB(text, features: features, priorHits: hits)
    if hits != beforeB { features = DiagnosticsScrubberFastScan.scanUTF8(text) }

    (text, hits) = applyPassD(text, features: features, priorHits: hits)
    if enforce4KiBCap && text.utf8.count > maxLineBytes {
      text = truncateLine4KiB(text)
    }
    return (text, hits)
  }

  static func replace(
    _ regex: NSRegularExpression, in text: String, with template: String, hits: inout Int
  ) -> String {
    let fullRange = NSRange(text.startIndex..., in: text)
    guard fullRange.length > 0,
      regex.firstMatch(in: text, options: [], range: fullRange) != nil
    else { return text }
    let mutable = NSMutableString(string: text)
    let count = regex.replaceMatches(
      in: mutable, options: [], range: NSRange(location: 0, length: mutable.length),
      withTemplate: template)
    hits += count
    return count > 0 ? (mutable as String) : text
  }

  private static func applyPassA(
    _ input: String,
    anchors: DiagnosticsScrubber.EnvironmentAnchors,
    features: DiagnosticsScrubberFastScan.UTF8Features,
    priorHits: Int
  ) -> (String, Int) {
    var text = input
    var hits = priorHits
    if features.hasPathSeparator {
      for pair in anchors.pathReplacements where pair.mayAppear(in: text, features: features) {
        text = replace(pair.regex, in: text, with: pair.target, hits: &hits)
      }
    }
    for pair in anchors.wordReplacements where pair.mayAppear(in: text, features: features) {
      text = replace(pair.regex, in: text, with: pair.target, hits: &hits)
    }
    return (text, hits)
  }

  private static func applyPassB(
    _ input: String, features: DiagnosticsScrubberFastScan.UTF8Features, priorHits: Int
  ) -> (String, Int) {
    guard features.hasSlash else { return (input, priorHits) }
    var text = input
    var hits = priorHits
    if DiagnosticsScrubberFastScan.containsASCII(text, "/Users/")
      || DiagnosticsScrubberFastScan.containsASCII(text, "/home/")
    {
      text = replace(homePathRegex, in: text, with: "/Users/<user>", hits: &hits)
    }
    if DiagnosticsScrubberFastScan.containsASCII(text, "/var/folders/") {
      if DiagnosticsScrubberFastScan.containsASCII(text, "/AppTranslocation/") {
        text = replace(
          darwinTranslocatedRegex, in: text,
          with: "/private/var/folders/<tmp>/AppTranslocation/<uuid>", hits: &hits)
      }
      text = replace(darwinTmpRegex, in: text, with: "/private/var/folders/<tmp>", hits: &hits)
    }
    if DiagnosticsScrubberFastScan.containsASCII(text, "/Volumes/") {
      text = replace(volumesRegex, in: text, with: "/Volumes/<volume>", hits: &hits)
    }
    return (text, hits)
  }

  private static func applyPassD(
    _ input: String, features: DiagnosticsScrubberFastScan.UTF8Features, priorHits: Int
  ) -> (String, Int) {
    var text = input
    var hits = priorHits

    if (features.hasAllLetters(bearerMask)
      && DiagnosticsScrubberFastScan.containsCaseInsensitiveASCII(text, lowerNeedle: bearerBytes))
      || (features.hasAllLetters(basicMask)
        && DiagnosticsScrubberFastScan.containsCaseInsensitiveASCII(text, lowerNeedle: basicBytes))
      || (features.hasAllLetters(digestMask)
        && DiagnosticsScrubberFastScan.containsCaseInsensitiveASCII(text, lowerNeedle: digestBytes))
    {
      text = replace(authSchemeRegex, in: text, with: "$1 <redacted-token>", hits: &hits)
    }
    if features.hasDot && DiagnosticsScrubberFastScan.containsASCII(text, "ai.auth.") {
      text = replace(wsSubprotoRegex, in: text, with: "ai.auth.<redacted-token>", hits: &hits)
    }
    if features.mayHaveIssuerKey {
      text = replace(issuerKeysRegex, in: text, with: "<redacted:api-key>", hits: &hits)
    }
    if features.hasJwtPrefix && features.hasDot {
      text = replace(jwtRegex, in: text, with: "<redacted:jwt>", hits: &hits)
    }
    if features.hasColon && features.hasAllLetters(cookieMask)
      && DiagnosticsScrubberFastScan.containsCaseInsensitiveASCII(text, lowerNeedle: cookieBytes)
    {
      text = replace(cookieHeaderRegex, in: text, with: "$1$2<redacted>", hits: &hits)
    }
    if features.hasEqualsOrColon && features.mayHaveSecretKvKeyword {
      text = applyPlainKvRedaction(text, hits: &hits)
    }
    if features.hasAt && features.hasDot {
      text = replace(emailRegex, in: text, with: "<redacted:email>", hits: &hits)
    }
    if features.hasMixed32TokenRun {
      text = applyRandomTokenRedaction(text, hits: &hits)
    }
    return (text, hits)
  }

  private static func applyPlainKvRedaction(_ text: String, hits: inout Int) -> String {
    let kvNs = text as NSString
    let fullRange = NSRange(location: 0, length: kvNs.length)
    guard plainKvRegex.firstMatch(in: text, options: [], range: fullRange) != nil else {
      return text
    }
    let kvMatches = plainKvRegex.matches(in: text, options: [], range: fullRange)
    var out: NSMutableString?
    for match in kvMatches.reversed() {
      let key = kvNs.substring(with: match.range(at: 1))
      guard isSecretKeyName(key) else { continue }
      let keyQuote = substringOrEmpty(kvNs, match.range(at: 2))
      let sep = kvNs.substring(with: match.range(at: 3))
      let (openQ, closeQ) = matchedQuotes(in: kvNs, match: match)
      let mutable = out ?? NSMutableString(string: text)
      mutable.replaceCharacters(
        in: match.range, with: "\(key)\(keyQuote)\(sep)\(openQ)<redacted>\(closeQ)")
      out = mutable
      hits += 1
    }
    return out.map { $0 as String } ?? text
  }

  private static func matchedQuotes(
    in ns: NSString, match: NSTextCheckingResult
  ) -> (open: String, close: String) {
    for (openIdx, closeIdx) in [(4, 6), (7, 9), (10, 12), (13, 15)] {
      if match.range(at: openIdx).location != NSNotFound {
        return (
          ns.substring(with: match.range(at: openIdx)),
          ns.substring(with: match.range(at: closeIdx))
        )
      }
    }
    return ("", "")
  }

  private static func substringOrEmpty(_ ns: NSString, _ range: NSRange) -> String {
    range.location != NSNotFound ? ns.substring(with: range) : ""
  }

  private static func applyRandomTokenRedaction(_ text: String, hits: inout Int) -> String {
    let tokNs = text as NSString
    let tokMatches = randomTokenRegex.matches(
      in: text, options: [], range: NSRange(location: 0, length: tokNs.length))
    guard !tokMatches.isEmpty else { return text }
    var out: NSMutableString?
    for match in tokMatches.reversed() {
      let candidate = tokNs.substring(with: match.range)
      if isHighEntropyRandomToken(candidate[...]) {
        let mutable = out ?? NSMutableString(string: text)
        mutable.replaceCharacters(in: match.range, with: "<redacted:high-entropy>")
        out = mutable
        hits += 1
      }
    }
    return out.map { $0 as String } ?? text
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
