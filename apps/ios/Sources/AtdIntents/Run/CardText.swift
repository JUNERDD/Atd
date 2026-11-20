import AtdActions
import AtdModel
import Foundation

/// A card as plain text: what Siri says and Shortcuts passes on, what 拷贝 copies, and the lines a
/// Live Activity shows.
public enum CardText {
  public static func text(
    _ card: CardResult, timeZone: TimeZone = .current, locale: Locale = .current
  ) -> String {
    lines(card, timeZone: timeZone, locale: locale).joined(separator: "\n")
  }

  /// The card line by line: a briefing's sentences; an event as 拷贝日程 copies it; an expense's
  /// amount, merchant, category and book, then its note; a notes card's title, headings, points
  /// and to-dos.
  public static func lines(
    _ card: CardResult, timeZone: TimeZone = .current, locale: Locale = .current
  ) -> [String] {
    switch card {
    case .text(let card): [card.text]
    case .briefing(let card): card.sentences
    case .event(let draft):
      draft.plainText(timeZone: timeZone).components(separatedBy: "\n").filter { !$0.isEmpty }
    case .expense(let draft): [expenseLine(draft, locale: locale)] + filled([draft.note])
    case .notes(let card): notesLines(card)
    }
  }

  /// ¥32.00 · 星巴克 · 餐饮 · 日常
  static func expenseLine(_ draft: ExpenseDraft, locale: Locale) -> String {
    let amount = draft.amount.formatted(.currency(code: draft.currency).locale(locale))
    return ([amount] + filled([draft.merchant, draft.category.name, draft.book]))
      .joined(separator: " · ")
  }

  static func notesLines(_ card: NotesCard) -> [String] {
    var lines = filled([card.title])
    for section in card.sections {
      lines += filled([section.heading]) + filled(section.bullets).map { "• \($0)" }
    }
    lines += card.todos.map { "☐ " + filled([$0.text, $0.owner]).joined(separator: " · ") }
    return lines
  }

  /// The parts that say something, trimmed.
  private static func filled(_ parts: [String?]) -> [String] {
    parts.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  }
}
