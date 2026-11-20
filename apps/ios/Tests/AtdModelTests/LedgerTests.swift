import Foundation
import Testing

@testable import AtdModel

@Suite struct LedgerTests {
  private static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt
    return calendar
  }

  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "LedgerTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  private func date(_ month: Int, _ day: Int, _ hour: Int = 12) throws -> Date {
    try #require(
      Self.calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour)))
  }

  /// An exact decimal from its digits; NaN, which equals nothing, for a typo.
  private func amount(_ digits: String) -> Decimal {
    Decimal(string: digits, locale: Locale(identifier: "en_US_POSIX")) ?? .nan
  }

  private func expense(
    _ id: String, _ digits: String, _ category: ExpenseCategory, _ currency: String = "CNY",
    on date: Date
  ) -> Expense {
    Expense(
      id: id, amount: amount(digits), currency: currency, category: category, book: "日常",
      date: date, createdAt: date, source: .manual)
  }

  /// Two November days in yuan, a lunch in yen on the 17th, the last moment of October and the
  /// first of December.
  private func ledger() throws -> Ledger {
    Ledger(expenses: [
      expense("noodles", "32", .dining, on: try date(11, 17, 12)),
      expense("metro", "6", .transport, on: try date(11, 17, 8)),
      expense("coffee", "30", .dining, on: try date(11, 17, 9)),
      expense("ramen", "980", .dining, "JPY", on: try date(11, 17, 13)),
      expense("lamp", "199.9", .home, on: try date(11, 14)),
      expense("october", "88", .shopping, on: try date(10, 31, 23)),
      expense("december", "10", .other, on: try date(12, 1, 0)),
    ])
  }

  @Test func aMonthsTotalsKeepEachCurrency() throws {
    let month = try ledger().spending(inMonthOf: try date(11, 17), calendar: Self.calendar)
    #expect(month.count == 5)
    #expect(month.totals == ["CNY": amount("267.9"), "JPY": 980])
    #expect(month.total("CNY") == amount("267.9"))
    #expect(month.total("USD") == 0)
  }

  @Test func todaysTotalAndCount() throws {
    let today = try ledger().spending(onDayOf: try date(11, 17, 20), calendar: Self.calendar)
    #expect(today.count == 4)
    #expect(today.total("CNY") == 68)
    #expect(today.total("JPY") == 980)
    #expect(try ledger().spending(onDayOf: try date(11, 16), calendar: Self.calendar) == Spending())
    let list = try ledger().expenses(onDayOf: try date(11, 17), calendar: Self.calendar)
    #expect(list.map(\.id) == ["ramen", "noodles", "coffee", "metro"])
  }

  @Test func aMonthByCategory() throws {
    let categories = try ledger().spendingByCategory(
      inMonthOf: try date(11, 1), calendar: Self.calendar)
    #expect(Set(categories.keys) == [.dining, .transport, .home])
    #expect(categories[.dining] == Spending(totals: ["CNY": 62, "JPY": 980], count: 3))
    #expect(categories[.home]?.total("CNY") == amount("199.9"))
  }

  @Test func theLastSevenDaysIncludeEmptyDays() throws {
    let end = try date(11, 18, 0)
    let week = DateInterval(start: try date(11, 11, 0), end: end)
    let days = try ledger().dailySpending(in: week, calendar: Self.calendar)
    #expect(days.count == 7)
    #expect(days.first?.day == (try date(11, 11, 0)))
    #expect(days.map { $0.spending.total("CNY") } == [0, 0, 0, amount("199.9"), 0, 0, 68])
    #expect(days.last?.spending.count == 4)
  }

  @Test func recentIsNewestFirst() throws {
    let ledger = try ledger()
    #expect(ledger.recent(3).map(\.id) == ["december", "ramen", "noodles"])
    #expect(ledger.recent(0).isEmpty && ledger.recent(-1).isEmpty)
    #expect(ledger.recent(100).count == 7)
  }

  /// A month includes its first moment and not the next month's.
  @Test func intervalsIncludeTheirStartAndNotTheirEnd() throws {
    let ledger = try ledger()
    let october = try #require(Self.calendar.dateInterval(of: .month, for: try date(10, 15)))
    #expect(ledger.expenses(in: october).map(\.id) == ["october"])
    let december = try #require(Self.calendar.dateInterval(of: .month, for: try date(12, 15)))
    #expect(ledger.expenses(in: december).map(\.id) == ["december"])
  }

  @Test func amountsStayExact() throws {
    var ledger = Ledger()
    for (index, digits) in ["0.1", "0.2"].enumerated() {
      ledger.add(expense("e\(index)", digits, .other, on: try date(11, 17)))
    }
    let day = ledger.spending(onDayOf: try date(11, 17), calendar: Self.calendar)
    #expect(day.total("CNY") == amount("0.3"))
  }

  @Test func theLedgerRoundTripsThroughTheSharedStore() throws {
    let store = SharedStore(directory: directory, notificationName: nil)
    #expect(store.load(Ledger.self).source == .missing)
    let stored = try ledger()
    try store.update(Ledger.self) { $0 = stored }
    let reloaded = store.load(Ledger.self)
    #expect(reloaded.source == .stored && reloaded.document == stored)
    let file = try String(contentsOf: store.url(for: Ledger.self), encoding: .utf8)
    #expect(file.contains(#""amount":199.9"#))
    #expect(file.contains(#""category":"home""#) && file.contains(#""source":"manual""#))

    var ledger = reloaded.document
    let removed = [ledger.remove("lamp"), ledger.remove("lamp")]
    #expect(removed == [true, false])
    #expect(ledger.expense("lamp") == nil && ledger.expense("metro") != nil)
  }

  @Test func categoriesHaveNamesAndSymbols() {
    let names = ExpenseCategory.allCases.map(\.name)
    #expect(names.allSatisfy { !$0.isEmpty } && Set(names).count == names.count)
    #expect(Set(ExpenseCategory.allCases.map(\.symbol)).count == ExpenseCategory.allCases.count)
  }
}
