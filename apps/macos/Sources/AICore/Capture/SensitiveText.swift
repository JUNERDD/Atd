import CoreGraphics
import Foundation

/// Text in a screenshot worth covering before it leaves the screen (architecture S6): email
/// addresses and phone numbers as the system's data detector finds them, keys and tokens by the
/// shapes their issuers give them, long tokens that read as random rather than as words, and card
/// numbers that pass the Luhn check. Overlapping findings cover their union, with the kind of the
/// longest original finding, then the more specific (``Source``): a phone number overlapping a
/// card number or a key never leaves any of either uncovered. It flags candidates; the user decides.
///
/// The detector and the expressions are built once and shared: both are immutable, and matching
/// with them is safe from any thread.
public enum SensitiveText {
  public enum Kind: String, CaseIterable, Sendable {
    case email, phone, key, card
  }

  /// A sensitive part of a text.
  public struct Match: Equatable, Sendable {
    public let kind: Kind
    public let range: Range<String.Index>
  }

  /// A sensitive part of an image, its box in the same space as the text boxes it came from.
  public struct Box: Equatable, Sendable {
    public let kind: Kind
    public let box: CGRect

    public init(kind: Kind, box: CGRect) {
      self.kind = kind
      self.box = box
    }
  }

  /// Every sensitive part of `text`, in order; no two overlap.
  public static func matches(in text: String) -> [Match] {
    let whole = NSRange(text.startIndex..., in: text)
    var findings: [Finding] = []
    func found(_ kind: Kind, _ source: Source, _ range: NSRange) {
      guard let bounds = Range(range, in: text) else { return }
      findings.append(
        Finding(match: Match(kind: kind, range: bounds), length: range.length, source: source))
    }
    for result in detector?.matches(in: text, range: whole) ?? [] {
      if result.resultType == .phoneNumber {
        found(.phone, .phone, result.range)
      } else if result.url?.scheme?.lowercased() == "mailto" {
        found(.email, .email, result.range)
      }
    }
    for pattern in patterns {
      for result in pattern.expression.matches(in: text, range: whole) {
        guard let bounds = Range(result.range, in: text), pattern.accepts(text[bounds]) else {
          continue
        }
        found(pattern.kind, pattern.source, result.range)
      }
    }
    var kept: [Finding] = []
    for finding in findings.sorted(by: { $0.match.range.lowerBound < $1.match.range.lowerBound }) {
      if let previous = kept.last, previous.match.range.overlaps(finding.match.range) {
        kept[kept.count - 1] = previous.merging(finding)
      } else {
        kept.append(finding)
      }
    }
    return kept.map(\.match)
  }

  /// The boxes with text still visible. Several mosaics may cover a box together; touching only
  /// its centre is not enough to hide it.
  public static func uncovered(_ boxes: [Box], by mosaics: [CGRect]) -> [Box] {
    let covers = mosaics.map(\.standardized)
    return boxes.filter { box in
      var visible = [box.box.standardized]
      for cover in covers {
        visible = visible.flatMap { remainder(of: $0, after: cover) }
        if visible.isEmpty { return false }
      }
      return true
    }
  }

  /// Subtracts a mosaic without merging the uncovered strips across an already covered area.
  private static func remainder(of box: CGRect, after cover: CGRect) -> [CGRect] {
    let overlap = box.intersection(cover)
    guard !overlap.isEmpty else { return [box] }
    return [
      CGRect(x: box.minX, y: box.minY, width: box.width, height: overlap.minY - box.minY),
      CGRect(x: box.minX, y: overlap.maxY, width: box.width, height: box.maxY - overlap.maxY),
      CGRect(
        x: box.minX, y: overlap.minY, width: overlap.minX - box.minX, height: overlap.height),
      CGRect(
        x: overlap.maxX, y: overlap.minY, width: box.maxX - overlap.maxX, height: overlap.height),
    ].filter { !$0.isEmpty }
  }

  // MARK: Findings

  /// What found a part, the most specific first.
  private enum Source: Int {
    case issuerKey, card, email, phone, randomToken
  }

  private struct Finding {
    let match: Match
    /// The original finding's length in UTF-16 units; unions keep the preferred finding's rank.
    let length: Int
    let source: Source

    /// Longer first; of two as long, the more specific, then the earlier.
    static func precedes(_ first: Finding, _ second: Finding) -> Bool {
      if first.length != second.length { return first.length > second.length }
      if first.source != second.source { return first.source.rawValue < second.source.rawValue }
      return first.match.range.lowerBound < second.match.range.lowerBound
    }

    func merging(_ other: Finding) -> Finding {
      let preferred = Self.precedes(self, other) ? self : other
      let lower = min(match.range.lowerBound, other.match.range.lowerBound)
      let upper = max(match.range.upperBound, other.match.range.upperBound)
      return Finding(
        match: Match(kind: preferred.match.kind, range: lower..<upper), length: preferred.length,
        source: preferred.source)
    }
  }

  // MARK: Patterns

  /// Email addresses (as `mailto:` links) and phone numbers.
  private static let detector = try? NSDataDetector(
    types: NSTextCheckingResult.CheckingType([.link, .phoneNumber]).rawValue)

  /// One shape of sensitive text, with a check of what it matched.
  private struct Pattern {
    let kind: Kind
    let source: Source
    let expression: NSRegularExpression
    let accepts: @Sendable (Substring) -> Bool
  }

  /// Characters a token is made of: a pattern must not start or end inside a longer run of them.
  private static let tokenEdge = "A-Za-z0-9_\\-"

  /// Keys by their issuers' prefixes, any long token that reads as random, and card numbers.
  private static let patterns: [Pattern] = [
    issuer("sk-[A-Za-z0-9_\\-]{16,}", accepts: hasDigit),
    issuer("gh[po]_[A-Za-z0-9]{20,}"),
    issuer("xox[bp]-[A-Za-z0-9\\-]{10,}", accepts: hasDigit),
    issuer("AKIA[0-9A-Z]{16}"),
    issuer("AIza[0-9A-Za-z_\\-]{35}"),
    issuer("eyJ[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}"),
    Pattern(
      kind: .key, source: .randomToken, expression: bounded("[A-Za-z0-9_+=\\-]{32,}"),
      accepts: looksRandom),
    Pattern(
      kind: .card, source: .card,
      expression: compile(#"(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])"#),
      accepts: passesLuhn),
  ]

  private static func issuer(
    _ pattern: String, accepts: @escaping @Sendable (Substring) -> Bool = { _ in true }
  ) -> Pattern {
    Pattern(kind: .key, source: .issuerKey, expression: bounded(pattern), accepts: accepts)
  }

  private static func bounded(_ pattern: String) -> NSRegularExpression {
    compile("(?<![\(tokenEdge)])\(pattern)(?![\(tokenEdge)])")
  }

  /// The patterns are literals, all compiled on the first match (so by every test that matches
  /// text): one that does not compile is a mistake in this file, not a condition to work around.
  private static func compile(_ pattern: String) -> NSRegularExpression {
    try! NSRegularExpression(pattern: pattern)
  }

  private static func hasDigit(_ token: Substring) -> Bool {
    token.contains { $0.isASCII && $0.isNumber }
  }

  /// A long token (ASCII, as its pattern takes it) that reads as random rather than as words: it
  /// mixes upper case, lower case and digits, with at least 10% digits spread across a third of
  /// its length. It switches classes often, words (``wordCharacters(in:)``) make up less than 55%
  /// of its letters and digits, and its characters carry at least 3.5 bits each. Hexadecimal
  /// hashes and UUIDs are identifiers, so the generic rule leaves them out.
  private static func looksRandom(_ token: Substring) -> Bool {
    guard !token.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return false }
    let classes = token.compactMap { character -> Int? in
      if character.isUppercase { return 0 }
      if character.isLowercase { return 1 }
      return character.isNumber ? 2 : nil
    }
    guard Set(classes).count == 3 else { return false }
    let digits = classes.indices.filter { classes[$0] == 2 }
    guard digits.count >= max(3, (classes.count + 9) / 10),
      let first = digits.first, let last = digits.last, last - first >= classes.count / 3
    else { return false }
    let switches = zip(classes, classes.dropFirst()).filter { $0 != $1 }.count
    guard Double(switches) >= 0.35 * Double(classes.count - 1),
      Double(wordCharacters(in: token)) < 0.55 * Double(classes.count)
    else { return false }
    return bitsPerCharacter(token) >= 3.5
  }

  /// How many of `token`'s characters belong to words: three or more lower-case letters in a
  /// row, with the capital before them if there is one, four or more characters in all.
  private static func wordCharacters(in token: Substring) -> Int {
    var total = 0
    var run = 0
    var capitalized = false
    var previousIsUpper = false
    func endRun() {
      let length = run + (capitalized ? 1 : 0)
      if run >= 3, length >= 4 { total += length }
      run = 0
    }
    for character in token {
      if character.isLowercase {
        if run == 0 { capitalized = previousIsUpper }
        run += 1
      } else {
        endRun()
      }
      previousIsUpper = character.isUppercase
    }
    endRun()
    return total
  }

  /// The Shannon entropy of `token`'s characters: repeated characters carry little.
  private static func bitsPerCharacter(_ token: Substring) -> Double {
    var counts: [Character: Int] = [:]
    for character in token { counts[character, default: 0] += 1 }
    let length = Double(token.count)
    return counts.values.reduce(0.0) { total, count in
      let share = Double(count) / length
      return total - share * log2(share)
    }
  }

  /// Whether the digits of `candidate` (spaces and hyphens apart) are 13 to 19 long and pass the
  /// Luhn check.
  static func passesLuhn(_ candidate: Substring) -> Bool {
    let digits = candidate.compactMap(\.wholeNumberValue)
    guard (13...19).contains(digits.count) else { return false }
    // From the right, every second digit is doubled, its digits summed.
    let sum = digits.reversed().enumerated().reduce(0) { total, item in
      let doubled = item.element * 2
      let value = item.offset.isMultiple(of: 2) ? item.element : doubled - (doubled > 9 ? 9 : 0)
      return total + value
    }
    return sum.isMultiple(of: 10)
  }
}
