import AtdModel
import Foundation

/// The shared expense ledger as 记账本 shows it, on its page (`atd.ledger`) and its widget: this
/// month and today in one currency, the last seven days and the month by category.
///
/// Amounts are never converted: the summary counts the currency of the latest expense (the
/// region's currency when there is none) and leaves the others out of its totals; recent
/// expenses keep their own currencies.
public struct MiniAppLedgerSummary: Sendable, Equatable {
  public var currency: String
  public var month: Decimal
  public var today: Decimal
  public var todayCount: Int
  /// The last seven days' spending, oldest first, today last.
  public var week: [Decimal]
  public var weekLabels: [String]
  /// This month's spending per category, largest first; categories with nothing are left out.
  public var byCategory: [(category: ExpenseCategory, amount: Decimal)]
  /// The latest expenses, newest first.
  public var recent: [Expense]

  public init(
    ledger: Ledger, now: Date = .now, calendar: Calendar = .current, locale: Locale = .current,
    regionCurrency: String = Locale.current.currency?.identifier ?? "CNY", recentLimit: Int = 50
  ) {
    let latest = ledger.expenses.max { $0.createdAt < $1.createdAt }
    let currency = latest?.currency ?? regionCurrency
    self.currency = currency
    month = ledger.spending(inMonthOf: now, calendar: calendar).total(currency)
    let today = ledger.expenses(onDayOf: now, calendar: calendar).filter { $0.currency == currency }
    self.today = today.reduce(0) { $0 + $1.amount }
    todayCount = today.count
    let start = calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now)) ?? now
    let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
    let days = ledger.dailySpending(in: DateInterval(start: start, end: end), calendar: calendar)
    week = days.map { $0.spending.total(currency) }
    var weekdays = calendar
    weekdays.locale = locale
    let symbols = weekdays.veryShortStandaloneWeekdaySymbols
    weekLabels = days.map { day in
      let index = calendar.component(.weekday, from: day.day) - 1
      return symbols.indices.contains(index) ? symbols[index] : ""
    }
    byCategory = ledger.spendingByCategory(inMonthOf: now, calendar: calendar)
      .compactMap { category, spending in
        let amount = spending.total(currency)
        return amount > 0 ? (category, amount) : nil
      }
      .sorted { $0.amount > $1.amount }
    recent = ledger.recent(recentLimit)
  }

  public static func == (lhs: MiniAppLedgerSummary, rhs: MiniAppLedgerSummary) -> Bool {
    lhs.currency == rhs.currency && lhs.month == rhs.month && lhs.today == rhs.today
      && lhs.todayCount == rhs.todayCount && lhs.week == rhs.week
      && lhs.byCategory.map(\.category) == rhs.byCategory.map(\.category)
      && lhs.byCategory.map(\.amount) == rhs.byCategory.map(\.amount) && lhs.recent == rhs.recent
  }

  /// What the page reads as `atd.ledger`: amounts as decimal strings (exact), each with its
  /// formatted text, so pages never do money arithmetic in floating point.
  public func json(now: Date = .now, locale: Locale = .current, calendar: Calendar = .current)
    -> MiniAppJSON
  {
    func money(_ amount: Decimal, _ code: String = currency) -> MiniAppJSON {
      [
        "amount": .string(NSDecimalNumber(decimal: amount).stringValue),
        "text": .string(MiniAppFormat.money(amount, currency: code, locale: locale)),
      ]
    }
    return [
      "currency": .string(currency),
      "month": money(month),
      "today": money(today),
      "todayCount": .number(Double(todayCount)),
      "week": .array(week.map { money($0) }),
      "weekLabels": .array(weekLabels.map(MiniAppJSON.string)),
      "byCategory": .array(
        byCategory.map { entry in
          [
            "category": .string(entry.category.rawValue), "name": .string(entry.category.name),
            "money": money(entry.amount),
          ]
        }),
      "categories": .array(
        ExpenseCategory.allCases.map { category in
          [
            "key": .string(category.rawValue), "name": .string(category.name),
            "symbol": .string(category.symbol),
          ]
        }),
      "recent": .array(
        recent.map { Self.json($0, now: now, locale: locale, calendar: calendar) }),
    ]
  }
}

extension MiniAppLedgerSummary {
  /// One expense as the page lists it (`atd.ledger.recent`) and `atd.ledger.add` returns it.
  public static func json(
    _ expense: Expense, now: Date = .now, locale: Locale = .current, calendar: Calendar = .current
  ) -> MiniAppJSON {
    let time = Date.FormatStyle(date: .omitted, time: .shortened).locale(locale)
    let day = Date.FormatStyle(date: .abbreviated, time: .omitted).locale(locale)
    let isToday = calendar.isDate(expense.date, inSameDayAs: now)
    return [
      "id": .string(expense.id),
      "money": [
        "amount": .string(NSDecimalNumber(decimal: expense.amount).stringValue),
        "text": .string(
          MiniAppFormat.money(expense.amount, currency: expense.currency, locale: locale)),
      ],
      "category": .string(expense.category.rawValue),
      "categoryName": .string(expense.category.name),
      "symbol": .string(expense.category.symbol),
      "note": expense.note.map(MiniAppJSON.string) ?? .null,
      "merchant": expense.merchant.map(MiniAppJSON.string) ?? .null,
      "when": .string(isToday ? expense.date.formatted(time) : expense.date.formatted(day)),
      "date": .string(expense.date.formatted(.iso8601)),
    ]
  }
}

/// Numbers and money as mini apps' cards and widgets write them.
public enum MiniAppFormat {
  /// `8,000`, `2.5`: grouped, at most two decimals.
  public static func number(_ value: Double, locale: Locale = .current) -> String {
    value.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
  }

  /// `¥2,384`, `¥32.5`.
  public static func money(_ amount: Decimal, currency: String, locale: Locale = .current)
    -> String
  {
    amount.formatted(
      .currency(code: currency).presentation(.narrow).precision(.fractionLength(0...2))
        .locale(locale))
  }

  /// `¥2.4K` (English), `¥2384` (Chinese, which groups by 万): for the Lock Screen's circle.
  public static func shortMoney(_ amount: Decimal, currency: String, locale: Locale = .current)
    -> String
  {
    amount.formatted(
      .currency(code: currency).presentation(.narrow).notation(.compactName)
        .precision(.significantDigits(1...3)).locale(locale))
  }

  /// A number with its unit: `3 杯`, or the number alone.
  public static func amount(_ value: Double, unit: String, locale: Locale = .current) -> String {
    unit.isEmpty ? number(value, locale: locale) : "\(number(value, locale: locale)) \(unit)"
  }
}
