import AtdModel
import Foundation

/// Why a card command produced no card although the model answered as asked.
public enum CardFailure: Error, Sendable, Equatable {
  /// The content has nothing of the kind: no event in the page, no amount on the photo, nothing
  /// on the board to organize. Running it again on the same content will not change that.
  case nothingFound(CardKind)

  /// One short line for the card's place.
  public var message: String {
    switch self {
    case .nothingFound(.event): CardPrompt.cards("card.nothingFound.event")
    case .nothingFound(.expense): CardPrompt.cards("card.nothingFound.expense")
    case .nothingFound(.notes): CardPrompt.cards("card.nothingFound.notes")
    case .nothingFound: CardPrompt.cards("card.nothingFound.other")
    }
  }
}

/// Reads a model's answer to a `CardPrompt` request into a card.
///
/// Reading is tolerant: the JSON object may sit in a code fence or among prose, amounts may be
/// strings with a currency sign, and lists may come as one string. What it yields is checked
/// strictly: an event needs a title and a start and cannot end before it starts, an expense
/// needs an amount above zero in a known currency, and a briefing or notes card needs content.
/// An answer that fails throws `ModelFailure.unreadable(detail:)`, whose detail names the
/// problem; an answer that says nothing was found (`{"found": false}`) throws
/// `CardFailure.nothingFound`.
///
/// The command's options apply here rather than in the model's answer: 提醒 sets the event's
/// alert, 记到 the expense's book, 详细程度 caps the briefing's sentences and 整理成 keeps only
/// the sections or the to-dos it asks for. `values` override the remembered ones, as in
/// `CardPrompt`.
public enum CardParser {
  public static func card(
    from answer: String, for command: Command, context: CardContext,
    values: [String: String] = [:]
  ) throws -> CardResult {
    let kind = command.output.cardKind
    switch kind {
    case .event:
      let alert = command.choice(EventAlert.self, values: values) ?? .off
      return .event(try event(decode(RawEvent.self, answer, kind), alert, context))
    case .expense:
      let key = BuiltinCommands.OptionKey.book
      let book = values[key] ?? command.option(key)?.value ?? ""
      return .expense(try expense(decode(RawExpense.self, answer, kind), book, context))
    case .briefing:
      let detail = command.choice(BriefingDetail.self, values: values) ?? .brief
      return .briefing(try briefing(decode(RawBriefing.self, answer, kind), detail))
    case .notes:
      let format = command.choice(NotesFormat.self, values: values) ?? .both
      return .notes(try notes(decode(RawNotes.self, answer, kind), format))
    case .text:
      guard let text = answer.nonBlank else { throw unreadable("an empty answer") }
      return .text(TextCard(text: text))
    }
  }

  /// Fields of the caller's own in the answer's JSON object (`CardRunner`'s `reading`); nil when
  /// there is no object or they do not decode.
  static func fields<Fields: Decodable>(_ type: Fields.Type, in answer: String) -> Fields? {
    object(in: answer).flatMap { try? JSONDecoder().decode(type, from: $0) }
  }

  /// The JSON object in the answer, from its first brace to its last.
  private static func object(in answer: String) -> Data? {
    guard let start = answer.firstIndex(of: "{"), let end = answer.lastIndex(of: "}"),
      start < end
    else { return nil }
    return Data(answer[start...end].utf8)
  }

  private static func decode<Raw: Decodable>(_ type: Raw.Type, _ answer: String, _ kind: CardKind)
    throws -> Raw
  {
    guard let object = object(in: answer) else { throw unreadable("no JSON object") }
    let decoder = JSONDecoder()
    if (try? decoder.decode(Found.self, from: object))?.found == false {
      throw CardFailure.nothingFound(kind)
    }
    do {
      return try decoder.decode(type, from: object)
    } catch {
      throw unreadable("a JSON object of another shape (\(error))")
    }
  }

  private static func event(_ raw: RawEvent, _ alert: EventAlert, _ context: CardContext) throws
    -> EventDraft
  {
    guard let title = raw.title?.nonBlank else { throw unreadable("an event without a title") }
    guard let start = raw.start?.nonBlank.flatMap({ CardFields.date($0, in: context) }) else {
      throw unreadable("an event without a start date")
    }
    let calendar = context.calendar
    let begins = start.hasTime ? start.date : calendar.startOfDay(for: start.date)
    var ends: Date?
    if let text = raw.end?.nonBlank {
      guard let end = CardFields.date(text, in: context) else {
        throw unreadable("an event end that is not a date")
      }
      // An all-day event's end is its last day, whatever time came with it.
      ends = start.hasTime ? end.date : calendar.startOfDay(for: end.date)
    }
    if let ends, ends < begins { throw unreadable("an event that ends before it starts") }
    return EventDraft(
      title: title, start: begins, end: ends, isAllDay: !start.hasTime,
      location: raw.location?.nonBlank, notes: raw.notes?.nonBlank, alert: alert)
  }

  private static func expense(_ raw: RawExpense, _ book: String, _ context: CardContext) throws
    -> ExpenseDraft
  {
    guard let amount = raw.amount?.value else { throw unreadable("an expense without an amount") }
    guard amount > 0 else { throw unreadable("an amount that is not above zero") }
    guard let currency = CardFields.currency(raw.currency?.nonBlank, default: context.currency)
    else { throw unreadable("a currency that is not an ISO 4217 code") }
    var date = context.now
    if let text = raw.date?.nonBlank {
      guard let paid = CardFields.date(text, in: context) else {
        throw unreadable("a payment date that is not a date")
      }
      date = paid.date
    }
    return ExpenseDraft(
      amount: amount, currency: currency, merchant: raw.merchant?.nonBlank,
      category: CardFields.category(raw.category?.nonBlank), date: date, book: book,
      note: raw.note?.nonBlank)
  }

  private static func briefing(_ raw: RawBriefing, _ detail: BriefingDetail) throws
    -> BriefingCard
  {
    let sentences = (raw.sentences?.lines ?? []).compactMap(\.nonBlank)
    guard !sentences.isEmpty else { throw unreadable("a briefing without sentences") }
    return BriefingCard(sentences: Array(sentences.prefix(detail.sentenceLimit)))
  }

  /// Keeps what the format asks for; an organized board with nothing in it is nothing found.
  private static func notes(_ raw: RawNotes, _ format: NotesFormat) throws -> NotesCard {
    let sections = (raw.sections ?? []).compactMap { section -> NotesCard.Section? in
      let bullets = (section.bullets?.lines ?? []).compactMap(\.nonBlank)
      let heading = section.heading?.nonBlank
      guard heading != nil || !bullets.isEmpty else { return nil }
      return NotesCard.Section(heading: heading ?? "", bullets: bullets)
    }
    let todos = (raw.todos ?? []).compactMap { todo in
      todo.text?.nonBlank.map { NotesCard.Todo(text: $0, owner: todo.owner?.nonBlank) }
    }
    let card = NotesCard(
      title: raw.title?.nonBlank, sections: format.includesSections ? sections : [],
      todos: format.includesTodos ? todos : [])
    guard !card.sections.isEmpty || !card.todos.isEmpty else {
      throw CardFailure.nothingFound(.notes)
    }
    return card
  }

  private static func unreadable(_ detail: String) -> ModelFailure {
    .unreadable(detail: "The card answer has \(detail).")
  }
}

/// `{"found": false}`: the model looked and found nothing of the kind.
private struct Found: Decodable {
  var found: Bool?
}

private struct RawEvent: Decodable {
  var title: String?
  var start: String?
  var end: String?
  var location: String?
  var notes: String?
}

private struct RawExpense: Decodable {
  var amount: CardFields.Amount?
  var currency: String?
  var merchant: String?
  var category: String?
  var note: String?
  var date: String?
}

private struct RawBriefing: Decodable {
  var sentences: CardFields.Lines?
}

private struct RawNotes: Decodable {
  struct Section: Decodable {
    var heading: String?
    var bullets: CardFields.Lines?
  }

  var title: String?
  var sections: [Section]?
  var todos: [CardFields.Todo]?
}
