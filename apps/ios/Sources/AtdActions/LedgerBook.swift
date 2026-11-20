import AtdModel
import Foundation
import WidgetKit

/// Logs expenses in the shared `Ledger` (记一笔 → 记入「记账本」) and takes them back. Every
/// writer goes through it — the camera, the share sheet, intents, automations and the 记账本
/// mini app — so each change also reloads the widgets that show the ledger.
public struct LedgerBook: Sendable {
  public let store: SharedStore
  private let reloadWidgets: @Sendable () -> Void

  /// - Parameter reloadWidgets: runs after every change the ledger took; by default it asks
  ///   WidgetKit to reload every widget's timeline.
  public init(
    store: SharedStore,
    reloadWidgets: @escaping @Sendable () -> Void = { WidgetCenter.shared.reloadAllTimelines() }
  ) {
    self.store = store
    self.reloadWidgets = reloadWidgets
  }

  /// The ledger as stored now.
  public var ledger: Ledger {
    store.load(Ledger.self).document
  }

  /// Logs the draft as a new expense and returns it; `remove(id:)` with its `id` undoes it.
  /// - Throws: `ActionError.invalidExpense` for an amount of zero or less or a blank currency,
  ///   or the store's error when the file cannot be written.
  @discardableResult
  public func add(_ draft: ExpenseDraft, source: ExpenseSource, at now: Date = .now) throws
    -> Expense
  {
    let currency = draft.currency.trimmingCharacters(in: .whitespacesAndNewlines)
    guard draft.amount > 0, !currency.isEmpty else { throw ActionError.invalidExpense }
    var draft = draft
    draft.currency = currency
    let expense = Expense(draft: draft, source: source, createdAt: now)
    try store.update(Ledger.self) { $0.add(expense) }
    reloadWidgets()
    return expense
  }

  /// Takes an expense out of the ledger: 撤销 right after logging it, or deleting it in 记账本.
  /// Returns whether it was still there.
  @discardableResult
  public func remove(id: Expense.ID) throws -> Bool {
    var removed = false
    try store.update(Ledger.self) { removed = $0.remove(id) }
    if removed { reloadWidgets() }
    return removed
  }

  /// What was paid in `currency` in the month of `date` (本月支出), as the ledger stands now.
  public func monthTotal(
    containing date: Date = .now, currency: String, calendar: Calendar = .current
  ) -> Decimal {
    ledger.spending(inMonthOf: date, calendar: calendar).total(currency)
  }
}
