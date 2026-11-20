import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct CardParserTests {
  static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt

  private var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = Self.zone
    return calendar
  }

  private func at(_ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
    try #require(
      calendar.date(
        from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute)))
  }

  /// Saturday 21 November 2026, 14:05 in Shanghai.
  private var context: CardContext {
    get throws { CardContext(now: try at(11, 21, 14, 5), timeZone: Self.zone, currency: "CNY") }
  }

  private func command(_ id: String) throws -> Command {
    try #require(BuiltinCommands.all().first { $0.id == id })
  }

  private func card(_ answer: String, _ id: String, values: [String: String] = [:]) throws
    -> CardResult
  {
    try CardParser.card(from: answer, for: command(id), context: context, values: values)
  }

  private func event(_ answer: String, values: [String: String] = [:]) throws -> EventDraft {
    guard case .event(let draft) = try card(answer, BuiltinCommands.eventID, values: values)
    else { throw ModelFailure.unreadable(detail: "not an event") }
    return draft
  }

  private func expense(_ answer: String, values: [String: String] = [:]) throws -> ExpenseDraft {
    guard case .expense(let draft) = try card(answer, BuiltinCommands.expenseID, values: values)
    else { throw ModelFailure.unreadable(detail: "not an expense") }
    return draft
  }

  /// The answer is no card: `ModelFailure.unreadable`, and nothing else.
  private func expectUnreadable(
    _ answer: String, _ id: String, sourceLocation: SourceLocation = #_sourceLocation
  ) {
    let error = #expect(throws: ModelFailure.self, sourceLocation: sourceLocation) {
      try card(answer, id)
    }
    guard case .unreadable? = error else {
      Issue.record("\(String(describing: error)) is not unreadable", sourceLocation: sourceLocation)
      return
    }
  }

  @Test func anEventReadsWithTheAlertItsOptionSets() throws {
    let draft = try event(
      #"{"title":"城市读书会","start":"2026-11-28T14:00","end":"2026-11-28T16:00","#
        + #""location":"静安图书馆 3 楼","notes":"带上读过的书"}"#)
    #expect(
      draft
        == EventDraft(
          title: "城市读书会", start: try at(11, 28, 14), end: try at(11, 28, 16),
          location: "静安图书馆 3 楼", notes: "带上读过的书", alert: .hourBefore))

    let alert = try #require(try command(BuiltinCommands.eventID).option(EventAlert.optionKey))
    let dayBefore = try event(
      #"{"title":"x","start":"2026-11-28T14:00"}"#, values: [alert.key: alert.choices[2]])
    #expect(dayBefore.alert == .dayBefore && dayBefore.end == nil)
  }

  /// Models wrap JSON in fences and prose, write `null`, blanks and offsets.
  @Test func anEventReadsFromAFencedOrChattyAnswer() throws {
    let draft = try event(
      """
      好的，我找到了一个日程：
      ```json
      {"title": "  产品周会 ", "start": "2026-11-23 15:00:00", "end": null, "location": "",
       "notes": null, "marks": [1, 2]}
      ```
      希望有帮助！
      """)
    #expect(try draft.title == "产品周会" && draft.start == at(11, 23, 15))
    #expect(draft.end == nil && draft.location == nil && draft.notes == nil && !draft.isAllDay)
    let zoned = try event(
      #"{"title":"x","start":"2026-11-23T07:00Z","end":"2026-11-23T17:00+08:00"}"#)
    #expect(try zoned.start == at(11, 23, 15) && zoned.end == at(11, 23, 17))
  }

  @Test func aDayWithoutATimeIsAllDay() throws {
    let trip = try event(#"{"title":"团建旅行","start":"2026-11-28","end":"2026-11-29T18:00"}"#)
    #expect(try trip.isAllDay && trip.start == at(11, 28) && trip.end == at(11, 29))
    let day = try event(#"{"title":"体检","start":"2026-12-01"}"#)
    #expect(try day.isAllDay && day.end == nil && day.effectiveEnd == at(12, 1))
  }

  @Test func eventsThatCannotBeAddedAreUnreadable() {
    let id = BuiltinCommands.eventID
    expectUnreadable(#"{"start":"2026-11-28T14:00"}"#, id)
    expectUnreadable(#"{"title":"  ","start":"2026-11-28T14:00"}"#, id)
    expectUnreadable(#"{"title":"读书会","start":"下周六下午两点"}"#, id)
    expectUnreadable(#"{"title":"读书会","start":"2026-02-30T14:00"}"#, id)
    expectUnreadable(#"{"title":"读书会","start":"2026-11-28T25:00"}"#, id)
    expectUnreadable(#"{"title":"读书会","start":"2026-11-28T14:00","end":"晚上"}"#, id)
    expectUnreadable(#"{"title":"读书会","start":"2026-11-28T14:00","end":"2026-11-28T13:00"}"#, id)
    expectUnreadable(#"{"title":["读书会"],"start":"2026-11-28T14:00"}"#, id)
    expectUnreadable("抱歉，这段内容里没有日程。", id)
    expectUnreadable("", id)
  }

  @Test func foundFalseMeansNothingOfTheKind() throws {
    #expect(throws: CardFailure.nothingFound(.event)) {
      try card(#"没有。{"found": false}"#, BuiltinCommands.eventID)
    }
    #expect(throws: CardFailure.nothingFound(.expense)) {
      try card(#"{"found":false}"#, BuiltinCommands.expenseID)
    }
    #expect(throws: CardFailure.nothingFound(.notes)) {
      try card(#"{"found":false}"#, BuiltinCommands.whiteboardID)
    }
    let messages = [CardKind.event, .expense, .notes, .briefing].map {
      CardFailure.nothingFound($0).message
    }
    #expect(messages.allSatisfy { !$0.isEmpty } && Set(messages.prefix(3)).count == 3)
  }

  @Test func anExpenseReadsIntoTheBookItsOptionNames() throws {
    let expense = try command(BuiltinCommands.expenseID)
    let book = try #require(expense.option(BuiltinCommands.OptionKey.book))
    let draft = try self.expense(
      #"{"amount":46.5,"currency":"CNY","merchant":"街角咖啡","category":"dining","#
        + #""note":"拿铁和可颂","date":"2026-11-17T15:20"}"#)
    #expect(
      draft
        == ExpenseDraft(
          amount: Decimal(string: "46.5") ?? 0, currency: "CNY", merchant: "街角咖啡",
          category: .dining, date: try at(11, 17, 15, 20), book: book.value, note: "拿铁和可颂"))
    let travel = try self.expense(#"{"amount":12}"#, values: [book.key: book.choices[1]])
    #expect(travel.book == book.choices[1])
    // No currency and no date: the context's currency, paid now.
    #expect(try travel.currency == "CNY" && travel.date == context.now)
    #expect(travel.category == .other && travel.merchant == nil && travel.note == nil)
  }

  @Test(arguments: [
    (#""¥1,234.50""#, "1234.5"), (#""46.5元""#, "46.5"), (#"" 32 ""#, "32"), ("0.1", "0.1"),
    (#""US$ 9.99""#, "9.99"),
  ])
  func amountsReadExactly(_ written: String, _ digits: String) throws {
    let draft = try expense(#"{"amount":\#(written)}"#)
    #expect(draft.amount == Decimal(string: digits, locale: Locale(identifier: "en_US_POSIX")))
  }

  @Test func currenciesAndCategoriesAreNormalized() throws {
    #expect(try expense(#"{"amount":980,"currency":"jpy"}"#).currency == "JPY")
    #expect(try expense(#"{"amount":5,"currency":"RMB"}"#).currency == "CNY")
    #expect(try expense(#"{"amount":5,"category":"transport"}"#).category == .transport)
    let named = ExpenseCategory.home.name
    #expect(try expense(#"{"amount":5,"category":"\#(named)"}"#).category == .home)
    #expect(try expense(#"{"amount":5,"category":"宠物"}"#).category == .other)
  }

  @Test func expensesThatCannotBeLoggedAreUnreadable() {
    let id = BuiltinCommands.expenseID
    expectUnreadable(#"{"merchant":"街角咖啡"}"#, id)
    expectUnreadable(#"{"amount":0}"#, id)
    expectUnreadable(#"{"amount":-12}"#, id)
    expectUnreadable(#"{"amount":"四十六"}"#, id)
    expectUnreadable(#"{"amount":"12.3.4"}"#, id)
    expectUnreadable(#"{"amount":46.5,"currency":"元"}"#, id)
    expectUnreadable(#"{"amount":46.5,"date":"昨天"}"#, id)
  }

  @Test func aBriefingKeepsAsManySentencesAsItsDetail() throws {
    let id = BuiltinCommands.briefingID
    let five = #"{"sentences":["一。","二。"," ","三。","四。","五。"]}"#
    #expect(try card(five, id) == .briefing(BriefingCard(sentences: ["一。", "二。", "三。"])))
    let detail = try #require(try command(id).option(BriefingDetail.optionKey))
    let full = try card(five, id, values: [detail.key: detail.choices[1]])
    #expect(full == .briefing(BriefingCard(sentences: ["一。", "二。", "三。", "四。", "五。"])))
    let lines = try card(#"{"sentences":"15:00 产品周会。\n19:00 取快递。"}"#, id)
    #expect(lines == .briefing(BriefingCard(sentences: ["15:00 产品周会。", "19:00 取快递。"])))
    expectUnreadable(#"{"sentences":[]}"#, id)
    expectUnreadable(#"{"summary":"今天很忙"}"#, id)
  }

  @Test func notesKeepWhatTheFormatAsksFor() throws {
    let id = BuiltinCommands.whiteboardID
    let answer = """
      {"title":"周五市集筹备","sections":[{"heading":"场地","bullets":["二楼露台"," "]},
       {"heading":" ","bullets":[]},{"heading":"","bullets":"音响\\n桌椅"}],
       "todos":[{"text":"周三前出海报","owner":"小周"},"联系摊主",{"text":" ","owner":"小王"}]}
      """
    let both = NotesCard(
      title: "周五市集筹备",
      sections: [
        .init(heading: "场地", bullets: ["二楼露台"]), .init(heading: "", bullets: ["音响", "桌椅"]),
      ],
      todos: [.init(text: "周三前出海报", owner: "小周"), .init(text: "联系摊主")])
    #expect(try card(answer, id) == .notes(both))

    let format = try #require(try command(id).option(NotesFormat.optionKey))
    let notes = try card(answer, id, values: [format.key: format.choices[0]])
    #expect(notes == .notes(NotesCard(title: both.title, sections: both.sections, todos: [])))
    let todos = try card(answer, id, values: [format.key: format.choices[1]])
    #expect(todos == .notes(NotesCard(title: both.title, sections: [], todos: both.todos)))
    // To-dos only, from a board that has none: nothing to organize.
    #expect(throws: CardFailure.nothingFound(.notes)) {
      try card(
        #"{"sections":[{"heading":"场地","bullets":["露台"]}],"todos":[]}"#, id,
        values: [format.key: format.choices[1]])
    }
  }

  @Test func otherCommandsGiveTheAnswerAsText() throws {
    #expect(try card("  改好的句子。\n", BuiltinCommands.polishID) == .text(TextCard(text: "改好的句子。")))
    let json = #"{"title":"读书会"}"#
    #expect(try card(json, BuiltinCommands.translateID) == .text(TextCard(text: json)))
    expectUnreadable(" \n ", BuiltinCommands.shortenID)
  }

  @Test func fieldsOfTheCallersOwnReadFromTheSameObject() {
    struct Marks: Decodable, Equatable {
      var marks: [Int]
    }
    let answer = "```json\n{\"title\":\"x\",\"start\":\"2026-11-28\",\"marks\":[3,1]}\n```"
    #expect(CardParser.fields(Marks.self, in: answer) == Marks(marks: [3, 1]))
    #expect(CardParser.fields(Marks.self, in: #"{"title":"x"}"#) == nil)
    #expect(CardParser.fields(Marks.self, in: "no object") == nil)
  }

  /// A model sometimes sends the card and the caller's keys as two objects.
  @Test func anAnswerSplitIntoObjectsReadsAsOne() throws {
    struct Marks: Decodable, Equatable {
      var marks: [Int]
    }
    let answer = """
      {"title":"周五市集筹备 {草稿}","sections":[],"todos":["联系摊主"]}
      {"marks":[2],"title":"另一个"}
      """
    let notes = NotesCard(title: "周五市集筹备 {草稿}", sections: [], todos: [.init(text: "联系摊主")])
    #expect(try card(answer, BuiltinCommands.whiteboardID) == .notes(notes))
    #expect(CardParser.fields(Marks.self, in: answer) == Marks(marks: [2]))
  }
}
