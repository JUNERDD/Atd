import AtdModel
import Foundation
import Testing

@testable import AtdActions

@Suite struct LedgerBookTests {
  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "LedgerBookTests-\(UUID().uuidString)", directoryHint: .isDirectory)
  private let reloads = WidgetReloads()

  private var book: LedgerBook {
    let reloads = reloads
    return LedgerBook(
      store: SharedStore(directory: directory, notificationName: nil),
      reloadWidgets: { reloads.reload() })
  }

  private func coffee(_ digits: String = "46.5", currency: String = "CNY") throws -> ExpenseDraft {
    ExpenseDraft(
      amount: try #require(Decimal(string: digits, locale: Locale(identifier: "en_US_POSIX"))),
      currency: currency, merchant: "街角咖啡", category: .dining,
      date: try Shanghai.at(17, 15, 20), book: "日常", note: "拿铁和可颂")
  }

  @Test func anAddedExpenseIsStoredAndReloadsTheWidgets() async throws {
    let logged = try book.add(try coffee(), source: .camera, at: try Shanghai.at(17, 15, 21))
    #expect(try logged.source == .camera && logged.createdAt == Shanghai.at(17, 15, 21))
    let expected = Expense(
      id: logged.id, draft: try coffee(), source: .camera, createdAt: logged.createdAt)
    #expect(logged == expected)
    #expect(book.ledger.expenses == [logged])
    #expect(reloads.value == 1)
    // Another process reads the same file.
    let reread = SharedStore(directory: directory, notificationName: nil).load(Ledger.self)
    #expect(reread.document.expense(logged.id) == logged)
  }

  @Test func removingTakesItBackOnce() async throws {
    let logged = try book.add(try coffee(), source: .share)
    #expect(try book.remove(id: logged.id))
    #expect(book.ledger.expenses.isEmpty && reloads.value == 2)
    #expect(try !book.remove(id: logged.id))
    #expect(reloads.value == 2)
  }

  @Test(arguments: [("0", "CNY"), ("-12", "CNY"), ("46.5", " ")])
  func expensesTheLedgerDoesNotKeepAreRejected(_ digits: String, _ currency: String) throws {
    let draft = try coffee(digits, currency: currency)
    #expect(throws: ActionError.invalidExpense) { try book.add(draft, source: .manual) }
    #expect(book.ledger.expenses.isEmpty && reloads.value == 0)
  }

  @Test func theCurrencyIsTrimmed() throws {
    #expect(try book.add(try coffee(currency: " JPY "), source: .intent).currency == "JPY")
  }

  @Test func theMonthsTotalCountsOneCurrency() throws {
    try book.add(try coffee(), source: .manual)
    try book.add(try coffee("980", currency: "JPY"), source: .camera)
    try book.add(try coffee("12"), source: .automation)
    let total = { (date: Date, currency: String) in
      book.monthTotal(containing: date, currency: currency, calendar: Shanghai.calendar)
    }
    let november = try Shanghai.at(30, 23)
    #expect(total(november, "CNY") == 58.5 && total(november, "JPY") == 980)
    let december = try #require(Shanghai.calendar.date(byAdding: .day, value: 2, to: november))
    #expect(total(december, "CNY") == 0)
  }
}
