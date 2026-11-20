import Foundation
import Testing

@testable import AtdModel

@Suite struct CardsTests {
  private static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt

  private static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    return calendar
  }

  private func date(_ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
    try #require(
      Self.calendar.date(
        from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)))
  }

  @Test func cardsRoundTripThroughJSON() throws {
    let cards: [CardResult] = [
      .event(EventDraft(title: "读书会", start: try date(21, 14), alert: .hourBefore)),
      .expense(
        ExpenseDraft(
          amount: Decimal(string: "46.5") ?? 0, currency: "CNY", merchant: "街角咖啡",
          category: .dining, date: try date(17, 15, 20), book: "日常", note: "拿铁和可颂")),
      .briefing(BriefingCard(sentences: ["15:00 产品周会。", "19:00 取快递。"])),
      .notes(
        NotesCard(
          title: "周五市集筹备", sections: [.init(heading: "场地", bullets: ["二楼露台"])],
          todos: [.init(text: "周三前出海报", owner: "小周")])),
      .text(TextCard(text: "结果")),
    ]
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    for card in cards {
      #expect(try decoder.decode(CardResult.self, from: encoder.encode(card)) == card)
    }
    #expect(cards.map(\.kind) == CardKind.allCases)
  }

  @Test func anEventWithoutAnEndLastsAnHourOrItsDay() throws {
    let timed = EventDraft(title: "x", start: try date(21, 18, 30), alert: .off)
    #expect(timed.end == nil)
    #expect(timed.effectiveEnd == (try date(21, 19, 30)))
    let allDay = EventDraft(title: "x", start: try date(21), isAllDay: true, alert: .off)
    #expect(allDay.effectiveEnd == (try date(21)))
    let ends = EventDraft(title: "x", start: try date(21, 14), end: try date(21, 16), alert: .off)
    #expect(ends.effectiveEnd == (try date(21, 16)))
  }

  /// The built-in options are read by position, so a library made in English reads the same.
  @Test func cardChoicesReadByPosition() throws {
    let event = try #require(BuiltinCommands.all().first { $0.id == BuiltinCommands.eventID })
    #expect(event.choice(EventAlert.self) == .hourBefore)
    let alert = try #require(event.option(EventAlert.optionKey))
    #expect(event.choice(EventAlert.self, values: ["alert": alert.choices[2]]) == .dayBefore)
    #expect(event.choice(EventAlert.self, values: ["alert": "not a choice"]) == nil)
    #expect(event.choice(BriefingDetail.self) == nil)

    var english = event
    english.options = [
      CommandOption(
        key: "alert", label: "Alert", choices: ["None", "1 hour before", "1 day before"],
        value: "None")
    ]
    #expect(english.choice(EventAlert.self) == .off)
    english.options[0].choices.removeLast()
    #expect(english.choice(EventAlert.self) == nil)

    let briefing = try #require(BuiltinCommands.all().first { $0.id == "briefing" })
    #expect(briefing.choice(BriefingDetail.self) == .brief)
    let whiteboard = try #require(BuiltinCommands.all().first { $0.id == "whiteboard" })
    #expect(whiteboard.choice(NotesFormat.self) == .both)
    #expect(NotesFormat.notes.includesSections && !NotesFormat.notes.includesTodos)
    #expect(!NotesFormat.todos.includesSections && NotesFormat.todos.includesTodos)
    #expect(BriefingDetail.brief.sentenceLimit == 3)
    let expense = try #require(BuiltinCommands.all().first { $0.id == "expense" })
    #expect(expense.option(BuiltinCommands.OptionKey.book)?.choices.count == 3)
  }

  @Test func remindersAreOverdueOnceTheirTimeOrDayHasPassed() throws {
    let now = try date(21, 10)
    let calendar = Self.calendar
    let timed = AgendaReminder(title: "交房租", due: try date(21, 9), hasDueTime: true)
    #expect(timed.isOverdue(at: now, calendar: calendar))
    let later = AgendaReminder(title: "取快递", due: try date(21, 19), hasDueTime: true)
    #expect(!later.isOverdue(at: now, calendar: calendar))
    let today = AgendaReminder(title: "买菜", due: try date(21), hasDueTime: false)
    #expect(!today.isOverdue(at: now, calendar: calendar))
    let yesterday = AgendaReminder(title: "报销", due: try date(20), hasDueTime: false)
    #expect(yesterday.isOverdue(at: now, calendar: calendar))
  }
}
