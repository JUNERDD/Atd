import Foundation

/// One logged expense in the `Ledger`.
public struct Expense: Codable, Sendable, Identifiable, Equatable, Hashable {
  public var id: String
  /// More than zero.
  public var amount: Decimal
  /// The ISO 4217 code (`CNY`).
  public var currency: String
  public var merchant: String?
  public var category: ExpenseCategory
  /// The book it is in (日常, 旅行, 报销).
  public var book: String
  /// What it was for (拿铁和可颂).
  public var note: String?
  /// When it was paid.
  public var date: Date
  /// When it was logged.
  public var createdAt: Date
  public var source: ExpenseSource

  public init(
    id: String = UUID().uuidString, amount: Decimal, currency: String, merchant: String? = nil,
    category: ExpenseCategory, book: String, note: String? = nil, date: Date, createdAt: Date,
    source: ExpenseSource
  ) {
    self.id = id
    self.amount = amount
    self.currency = currency
    self.merchant = merchant
    self.category = category
    self.book = book
    self.note = note
    self.date = date
    self.createdAt = createdAt
    self.source = source
  }

  /// The draft, logged at `createdAt` from `source`.
  public init(
    id: String = UUID().uuidString, draft: ExpenseDraft, source: ExpenseSource, createdAt: Date
  ) {
    self.init(
      id: id, amount: draft.amount, currency: draft.currency, merchant: draft.merchant,
      category: draft.category, book: draft.book, note: draft.note, date: draft.date,
      createdAt: createdAt, source: source)
  }
}

/// What an expense was for. A new category changes the ledger's schema: a build that does not
/// know it cannot read the file.
public enum ExpenseCategory: String, Codable, Sendable, CaseIterable {
  case dining
  case transport
  case shopping
  case home
  case other

  /// 餐饮, 交通, 购物, 居家, 其他.
  public var name: String {
    switch self {
    case .dining: String(localized: "category.dining", bundle: .module)
    case .transport: String(localized: "category.transport", bundle: .module)
    case .shopping: String(localized: "category.shopping", bundle: .module)
    case .home: String(localized: "category.home", bundle: .module)
    case .other: String(localized: "category.other", bundle: .module)
    }
  }

  /// An SF Symbol name.
  public var symbol: String {
    switch self {
    case .dining: "fork.knife"
    case .transport: "tram"
    case .shopping: "bag"
    case .home: "house"
    case .other: "receipt"
    }
  }
}

/// Where an expense was logged from. A new source changes the ledger's schema, as a new
/// category does.
public enum ExpenseSource: String, Codable, Sendable, CaseIterable {
  /// Typed in by hand, in the 记账本 mini app.
  case manual
  /// Read from a photo in Atd's camera.
  case camera
  /// Read from something shared to Atd.
  case share
  /// Through an App Intent the person ran: Siri, Shortcuts, Spotlight or a control.
  case intent
  /// By an automation step.
  case automation
}
