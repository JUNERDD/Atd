import Foundation

/// The expense ledger (`ledger.json`) that 记一笔, the camera, the 记账本 mini app and its
/// widgets share. AtdActions' `LedgerBook` writes it, so every change reloads the widgets.
///
/// Amounts in different currencies are never added together or converted: every query returns
/// `Spending`, which keeps one sum per currency, and `Spending.total(_:)` reads one of them.
/// Intervals include their start and exclude their end.
public struct Ledger: SharedDocument {
  public static let fileName = "ledger.json"
  public static let schemaVersion = 1

  /// In the order they were logged.
  public var expenses: [Expense]

  public init(expenses: [Expense] = []) {
    self.expenses = expenses
  }

  public static func initial() -> Ledger {
    Ledger()
  }

  public func expense(_ id: Expense.ID) -> Expense? {
    expenses.first { $0.id == id }
  }

  public mutating func add(_ expense: Expense) {
    expenses.append(expense)
  }

  /// Removes the expense with this id; returns whether there was one.
  @discardableResult
  public mutating func remove(_ id: Expense.ID) -> Bool {
    guard let index = expenses.firstIndex(where: { $0.id == id }) else { return false }
    expenses.remove(at: index)
    return true
  }

  /// The expenses paid within `interval`, newest first.
  public func expenses(in interval: DateInterval) -> [Expense] {
    newestFirst(expenses.filter { interval.start <= $0.date && $0.date < interval.end })
  }

  /// The expenses paid on the day of `date`, newest first (今天的账).
  public func expenses(onDayOf date: Date, calendar: Calendar = .current) -> [Expense] {
    calendar.dateInterval(of: .day, for: date).map(expenses(in:)) ?? []
  }

  /// The `limit` most recently paid expenses, newest first.
  public func recent(_ limit: Int) -> [Expense] {
    Array(newestFirst(expenses).prefix(max(limit, 0)))
  }

  /// What was paid within `interval`.
  public func spending(in interval: DateInterval) -> Spending {
    Spending(expenses(in: interval))
  }

  /// What was paid on the day of `date` (今天 ¥68 · 3 笔).
  public func spending(onDayOf date: Date, calendar: Calendar = .current) -> Spending {
    calendar.dateInterval(of: .day, for: date).map(spending(in:)) ?? Spending()
  }

  /// What was paid in the month of `date` (本月支出).
  public func spending(inMonthOf date: Date, calendar: Calendar = .current) -> Spending {
    calendar.dateInterval(of: .month, for: date).map(spending(in:)) ?? Spending()
  }

  /// What was paid in each category within `interval`; a category with nothing paid in it is
  /// left out.
  public func spendingByCategory(in interval: DateInterval) -> [ExpenseCategory: Spending] {
    Dictionary(grouping: expenses(in: interval), by: \.category).mapValues(Spending.init)
  }

  /// What was paid in each category in the month of `date` (the month's breakdown).
  public func spendingByCategory(inMonthOf date: Date, calendar: Calendar = .current)
    -> [ExpenseCategory: Spending]
  {
    calendar.dateInterval(of: .month, for: date).map(spendingByCategory(in:)) ?? [:]
  }

  /// What was paid on each day of `interval`, oldest first, days with nothing paid included:
  /// the bars of the last seven days, or the days of a month.
  public func dailySpending(in interval: DateInterval, calendar: Calendar = .current)
    -> [DailySpending]
  {
    var days: [DailySpending] = []
    var day = calendar.startOfDay(for: interval.start)
    while day < interval.end, let next = calendar.date(byAdding: .day, value: 1, to: day) {
      days.append(
        DailySpending(day: day, spending: spending(in: DateInterval(start: day, end: next))))
      day = next
    }
    return days
  }

  /// By the date paid, then the moment logged, newest first.
  private func newestFirst(_ expenses: [Expense]) -> [Expense] {
    expenses.sorted { ($0.date, $0.createdAt) > ($1.date, $1.createdAt) }
  }
}

/// What was paid within some time: one sum per currency, never converted, and how many
/// expenses make them up.
public struct Spending: Sendable, Equatable, Hashable {
  /// The sum per ISO 4217 code.
  public var totals: [String: Decimal]
  /// How many expenses, in every currency.
  public var count: Int

  public init(totals: [String: Decimal] = [:], count: Int = 0) {
    self.totals = totals
    self.count = count
  }

  init(_ expenses: [Expense]) {
    self.init(
      totals: expenses.reduce(into: [:]) { $0[$1.currency, default: 0] += $1.amount },
      count: expenses.count)
  }

  /// The sum in `currency`; zero when nothing was paid in it.
  public func total(_ currency: String) -> Decimal {
    totals[currency] ?? 0
  }
}

/// What was paid on one day.
public struct DailySpending: Sendable, Equatable, Hashable {
  /// The start of the day.
  public var day: Date
  public var spending: Spending

  public init(day: Date, spending: Spending) {
    self.day = day
    self.spending = spending
  }
}
