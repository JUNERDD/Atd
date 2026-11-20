import Foundation

/// The card a result is shown as when a surface shows it instead of writing it into a field: the
/// share sheet, the camera, Siri, and the briefing's Live Activity. Each surface draws its own.
public enum CardKind: String, Codable, Sendable, CaseIterable {
  /// A calendar event to add (提取日程).
  case event
  /// An expense to log (记一笔).
  case expense
  /// A few sentences about today (今日简报).
  case briefing
  /// Notes and to-dos (整理白板).
  case notes
  /// Plain text: the person's own card commands, and text commands shown on a card.
  case text
}

/// One card's content, as `CardRunner` reads it from a model's answer.
public enum CardResult: Codable, Sendable, Equatable, Hashable {
  case event(EventDraft)
  case expense(ExpenseDraft)
  case briefing(BriefingCard)
  case notes(NotesCard)
  case text(TextCard)

  public var kind: CardKind {
    switch self {
    case .event: .event
    case .expense: .expense
    case .briefing: .briefing
    case .notes: .notes
    case .text: .text
    }
  }
}

/// A calendar event found in what was shared or photographed, for the person to check before
/// `CalendarWriter` adds it.
public struct EventDraft: Codable, Sendable, Equatable, Hashable {
  /// How long an event lasts when the content gives no end: an hour, as in Calendar.
  public static let defaultDuration: TimeInterval = 60 * 60

  public var title: String
  /// When a timed event starts; for an all-day event, a moment of its first day.
  public var start: Date
  /// When a timed event ends, or an all-day event's last day; nil when the content gives none.
  public var end: Date?
  public var isAllDay: Bool
  public var location: String?
  /// Details Calendar keeps with the event (what to bring, whom to ask for).
  public var notes: String?
  public var alert: EventAlert

  public init(
    title: String, start: Date, end: Date? = nil, isAllDay: Bool = false, location: String? = nil,
    notes: String? = nil, alert: EventAlert
  ) {
    self.title = title
    self.start = start
    self.end = end
    self.isAllDay = isAllDay
    self.location = location
    self.notes = notes
    self.alert = alert
  }

  /// The end to show and write: the given one, or else an hour after the start of a timed event
  /// and the first day of an all-day one.
  public var effectiveEnd: Date {
    end ?? (isAllDay ? start : start.addingTimeInterval(Self.defaultDuration))
  }
}

/// When Calendar alerts before an event (提醒). The 提取日程 command's option lists its choices
/// in this order: 不提醒, 提前 1 小时, 提前 1 天.
public enum EventAlert: String, Codable, Sendable, CardChoice {
  case off
  case hourBefore
  case dayBefore

  public static let optionKey = BuiltinCommands.OptionKey.alert
}

/// An expense read from a receipt, a payment screen or a message, for `LedgerBook` to log.
public struct ExpenseDraft: Codable, Sendable, Equatable, Hashable {
  /// What was paid; more than zero.
  public var amount: Decimal
  /// The ISO 4217 code (`CNY`).
  public var currency: String
  public var merchant: String?
  public var category: ExpenseCategory
  /// When it was paid.
  public var date: Date
  /// The book it goes in (日常, 旅行, 报销), as the command's 记到 option
  /// (`BuiltinCommands.OptionKey.book`) names it.
  public var book: String
  /// What it was for (拿铁和可颂).
  public var note: String?

  public init(
    amount: Decimal, currency: String, merchant: String? = nil, category: ExpenseCategory,
    date: Date, book: String, note: String? = nil
  ) {
    self.amount = amount
    self.currency = currency
    self.merchant = merchant
    self.category = category
    self.date = date
    self.book = book
    self.note = note
  }
}

/// Today in a few sentences (今日简报), the most important first.
public struct BriefingCard: Codable, Sendable, Equatable, Hashable {
  public var sentences: [String]

  public init(sentences: [String]) {
    self.sentences = sentences
  }
}

/// How long the briefing is (详细程度): its option lists 三句话 and 完整 in this order.
public enum BriefingDetail: String, Codable, Sendable, CardChoice {
  /// At most three sentences.
  case brief
  /// Every event and reminder.
  case full

  public static let optionKey = BuiltinCommands.OptionKey.detail

  /// The most sentences a briefing of this detail has.
  public var sentenceLimit: Int {
    switch self {
    case .brief: 3
    case .full: 8
    }
  }
}

/// A whiteboard, notes or a document, organized (整理白板): titled sections of short lines, and
/// the to-dos found in them.
public struct NotesCard: Codable, Sendable, Equatable, Hashable {
  public struct Section: Codable, Sendable, Equatable, Hashable {
    public var heading: String
    public var bullets: [String]

    public init(heading: String, bullets: [String]) {
      self.heading = heading
      self.bullets = bullets
    }
  }

  public struct Todo: Codable, Sendable, Equatable, Hashable {
    public var text: String
    /// Whom it is assigned to, as written (小周); nil when nobody is named.
    public var owner: String?

    public init(text: String, owner: String? = nil) {
      self.text = text
      self.owner = owner
    }
  }

  public var title: String?
  /// Empty when the person asked for to-dos only.
  public var sections: [Section]
  /// Empty when the person asked for notes only.
  public var todos: [Todo]

  public init(title: String? = nil, sections: [Section], todos: [Todo]) {
    self.title = title
    self.sections = sections
    self.todos = todos
  }
}

/// What the notes are organized into (整理成): its option lists 笔记, 待办 and 两者 in this order.
public enum NotesFormat: String, Codable, Sendable, CardChoice {
  case notes
  case todos
  case both

  public static let optionKey = BuiltinCommands.OptionKey.format

  public var includesSections: Bool { self != .todos }
  public var includesTodos: Bool { self != .notes }
}

/// A result shown as plain text.
public struct TextCard: Codable, Sendable, Equatable, Hashable {
  public var text: String

  public init(text: String) {
    self.text = text
  }
}

/// An option of a built-in card command read as a typed value. The option's choices are in the
/// order of `allCases`, so a remembered value maps by its position, whichever language the
/// library was created in.
public protocol CardChoice: CaseIterable, Sendable where AllCases == [Self] {
  /// The option's key in the command.
  static var optionKey: String { get }
}

extension Command {
  /// What the option `Choice.optionKey` is set to: the value in `values` (a choice made on a card
  /// and not saved yet), or else the remembered one. Nil when the command has no such option or
  /// its choices do not line up with `Choice`.
  public func choice<Choice: CardChoice>(_ type: Choice.Type, values: [String: String] = [:])
    -> Choice?
  {
    guard let option = option(Choice.optionKey), option.choices.count == Choice.allCases.count,
      let index = option.choices.firstIndex(of: values[option.key] ?? option.value)
    else { return nil }
    return Choice.allCases[index]
  }
}
