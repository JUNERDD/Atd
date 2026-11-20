import AtdModel
import Foundation

/// What a card command reads: what was shared or photographed, or a day's agenda.
public struct CardInput: Sendable, Equatable {
  /// What was shared, as text: a message, or a page's title, address and text.
  public var text: String
  /// Photos or screenshots, sent with the text.
  public var images: [ModelImage]
  /// The day's agenda (`TodayReader`), which the briefing reads; the other kinds ignore it.
  public var agenda: Agenda?

  public init(text: String = "", images: [ModelImage] = [], agenda: Agenda? = nil) {
    self.text = text
    self.images = images
    self.agenda = agenda
  }
}

/// When and where a card command runs. Relative dates in the content (明天下午三点) resolve
/// against `now` in `timeZone`, the dates the model writes are read in `timeZone`, and an amount
/// that shows no currency is in `currency`.
public struct CardContext: Sendable, Equatable {
  public var now: Date
  public var timeZone: TimeZone
  /// An ISO 4217 code.
  public var currency: String

  public init(
    now: Date = .now, timeZone: TimeZone = .current, currency: String = regionCurrency
  ) {
    self.now = now
    self.timeZone = timeZone
    self.currency = currency
  }

  /// The person's region's currency; CNY for a region without one.
  public static var regionCurrency: String {
    Locale.current.currency?.identifier ?? "CNY"
  }

  /// The Gregorian calendar in `timeZone`, the one ISO 8601 dates are written in.
  var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    return calendar
  }

  /// 2026-11-21.
  func dayStamp(_ date: Date) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// 11-21.
  func monthDay(_ date: Date) -> String {
    let parts = calendar.dateComponents([.month, .day], from: date)
    return String(format: "%02ld-%02ld", parts.month ?? 0, parts.day ?? 0)
  }

  /// 14:05.
  func clock(_ date: Date) -> String {
    let parts = calendar.dateComponents([.hour, .minute], from: date)
    return String(format: "%02ld:%02ld", parts.hour ?? 0, parts.minute ?? 0)
  }

  /// The weekday in the prompt's language, which relative dates (下周五) count from.
  func weekday(_ date: Date) -> String {
    var style = Date.FormatStyle.dateTime.weekday(.wide)
    style.locale = Locale(identifier: Bundle.module.preferredLocalizations.first ?? "en")
    style.timeZone = timeZone
    return date.formatted(style)
  }
}

/// Builds the request a card command sends (提取日程, 记一笔, 今日简报, 整理白板, and the
/// person's own card commands).
///
/// An event, expense, briefing or notes card asks for one JSON object whose keys the system
/// prompt lists, then the command's instructions, its options other than the one the card reads
/// itself (`CardParser` applies 提醒 and 记到; 详细程度 and 整理成 become rules), and the current
/// time for relative dates. A text card asks for plain text, as `CommandPrompt` does. The person's
/// turn is the content with its photos, or the agenda for the briefing. Like every prompt, it is
/// written in the app's language.
public enum CardPrompt {
  /// - Parameter values: option values chosen for this run that override the remembered ones.
  public static func request(
    _ command: Command, input: CardInput, context: CardContext, values: [String: String] = [:]
  ) -> ModelRequest {
    let kind = command.output.cardKind
    guard kind != .text else {
      return CommandPrompt.request(
        .command(command, values: values), input: input.text, images: input.images)
    }
    var lines = [
      String(localized: "prompt.instructions \(command.instructions)", bundle: .module)
    ]
    for option in command.options where option.key != readKey(of: kind) {
      let value = values[option.key] ?? option.value
      lines.append(String(localized: "prompt.option \(option.label) \(value)", bundle: .module))
    }
    if kind != .notes { lines.append(now(context)) }
    let rules = [cards("card.json"), schema(kind, command: command, values: values, context)]
    let system = rules.joined(separator: "\n") + "\n\n" + lines.joined(separator: "\n")

    let turn: String
    if kind == .briefing {
      turn = agendaText(input.agenda, context: context)
    } else if !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      turn = input.text
    } else {
      // Providers refuse an empty text part, and a photo needs no more than this.
      turn = input.images.isEmpty ? command.instructions : cards("card.inPhoto")
    }
    return ModelRequest(system: system, messages: [ModelMessage(.user, turn, images: input.images)])
  }

  /// The option a card reads itself rather than passing on as a line.
  private static func readKey(of kind: CardKind) -> String? {
    switch kind {
    case .event: EventAlert.optionKey
    case .expense: BuiltinCommands.OptionKey.book
    case .briefing: BriefingDetail.optionKey
    case .notes: NotesFormat.optionKey
    case .text: nil
    }
  }

  /// The keys of the kind's JSON object, and its rules.
  private static func schema(
    _ kind: CardKind, command: Command, values: [String: String], _ context: CardContext
  ) -> String {
    switch kind {
    case .event:
      return cards("card.event")
    case .expense:
      return cards("card.expense \(context.currency)")
    case .briefing:
      let detail = command.choice(BriefingDetail.self, values: values) ?? .brief
      return cards(detail == .brief ? "card.briefing.brief" : "card.briefing.full")
    case .notes:
      let format = command.choice(NotesFormat.self, values: values) ?? .both
      let rule: String? =
        switch format {
        case .notes: cards("card.notes.sectionsOnly")
        case .todos: cards("card.notes.todosOnly")
        case .both: nil
        }
      return ([cards("card.notes")] + [rule].compactMap { $0 }).joined(separator: "\n")
    case .text:
      return ""
    }
  }

  /// 现在是 2026-11-21 14:05（星期六），时区 Asia/Shanghai…
  private static func now(_ context: CardContext) -> String {
    let stamp = "\(context.dayStamp(context.now)) \(context.clock(context.now))"
    let zone = context.timeZone.identifier
    return cards("card.now \(stamp) \(context.weekday(context.now)) \(zone)")
  }

  /// A string from the card prompts' table.
  static func cards(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Cards", bundle: .module)
  }
}
