import AtdModel
import Foundation

/// How `CardParser` reads the values in a card answer that models write in more than one way.
enum CardFields {
  /// A date as the prompts ask for it: `2026-11-21T18:30` (seconds, a space for the `T`, or a
  /// UTC offset are fine too) or `2026-11-21` for a day. Without an offset it is local time in
  /// the context's time zone. Nil for anything else, an impossible date (2月30日) included.
  static func date(_ text: String, in context: CardContext) -> (date: Date, hasTime: Bool)? {
    let pattern =
      #/([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:[T ]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?)?\s*(Z|[+-][0-9]{2}:?[0-9]{2})?/#
    guard let match = text.wholeMatch(of: pattern) else { return nil }
    var calendar = context.calendar
    if let offset = match.7 {
      guard let zone = timeZone(offset: String(offset)) else { return nil }
      calendar.timeZone = zone
    }
    let number = { (part: Substring?) in part.flatMap { Int($0) } }
    let components = DateComponents(
      year: number(match.1), month: number(match.2), day: number(match.3),
      hour: number(match.4) ?? 0, minute: number(match.5) ?? 0, second: number(match.6) ?? 0)
    guard components.isValidDate(in: calendar), let date = calendar.date(from: components) else {
      return nil
    }
    return (date, match.4 != nil)
  }

  /// `Z`, `+08:00` or `-0530`.
  private static func timeZone(offset: String) -> TimeZone? {
    guard offset != "Z" else { return TimeZone(secondsFromGMT: 0) }
    let digits = offset.dropFirst().filter(\.isNumber)
    guard digits.count == 4, let hours = Int(digits.prefix(2)), let minutes = Int(digits.suffix(2))
    else { return nil }
    let seconds = (hours * 60 + minutes) * 60
    return TimeZone(secondsFromGMT: offset.hasPrefix("-") ? -seconds : seconds)
  }

  /// An ISO 4217 code; `RMB`, the code-like name people write for the yuan, reads as CNY. A
  /// missing currency is the default one; nil for anything that is not a currency code.
  static func currency(_ text: String?, default fallback: String) -> String? {
    guard let text else { return fallback }
    let code = text.uppercased() == "RMB" ? "CNY" : text.uppercased()
    return Locale.Currency.isoCurrencies.contains(Locale.Currency(code)) ? code : nil
  }

  /// The category by its key (`dining`) or its name (餐饮, Dining); other, for anything else, is
  /// what the category means.
  static func category(_ text: String?) -> ExpenseCategory {
    guard let text = text?.lowercased() else { return .other }
    return ExpenseCategory.allCases.first { $0.rawValue == text || $0.name.lowercased() == text }
      ?? .other
  }

  /// An amount written as a number (46.5) or as a string with a currency sign or word around it
  /// (¥46.00, 46.5元, 1,234.50). Nil when it holds no plain decimal number.
  struct Amount: Decodable {
    var value: Decimal?

    init(from decoder: any Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let number = try? container.decode(Decimal.self) {
        value = number
      } else if let text = try? container.decode(String.self) {
        value = Self.decimal(text)
      }
    }

    static func decimal(_ text: String) -> Decimal? {
      let ascii = { (character: Character) in character.isASCII && character.isNumber }
      var number = text.filter { !$0.isWhitespace && $0 != "," }
      while let first = number.first, !ascii(first), first != "-", first != "." {
        number.removeFirst()
      }
      while let last = number.last, !ascii(last) { number.removeLast() }
      guard number.wholeMatch(of: #/-?[0-9]+(\.[0-9]+)?/#) != nil else { return nil }
      return Decimal(string: number, locale: Locale(identifier: "en_US_POSIX"))
    }
  }

  /// A list of lines written as an array of strings or as one string, a line each.
  struct Lines: Decodable {
    var lines: [String]

    init(from decoder: any Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let text = try? container.decode(String.self) {
        lines = text.components(separatedBy: .newlines)
      } else {
        lines = try container.decode([String].self)
      }
    }
  }

  /// A to-do written as `{"text": …, "owner": …}` or as a plain string.
  struct Todo: Decodable {
    var text: String?
    var owner: String?

    private enum CodingKeys: String, CodingKey {
      case text, owner
    }

    init(from decoder: any Decoder) throws {
      if let text = try? decoder.singleValueContainer().decode(String.self) {
        self.text = text
        return
      }
      let container = try decoder.container(keyedBy: CodingKeys.self)
      text = try container.decodeIfPresent(String.self, forKey: .text)
      owner = try container.decodeIfPresent(String.self, forKey: .owner)
    }
  }
}

extension String {
  /// The string without the whitespace around it; nil when nothing else is left.
  var nonBlank: String? {
    let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}
