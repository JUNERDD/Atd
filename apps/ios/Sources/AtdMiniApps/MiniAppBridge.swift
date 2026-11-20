import AtdModel
import Foundation

/// What a page asks through `window.atd`, read from a message it posted and checked before
/// anything happens. The app's web view host performs it (AtdAppUI), so this stays testable
/// without WebKit.
public enum MiniAppBridgeRequest: Sendable, Equatable {
  /// A change to the app's own data.
  case change(MiniAppOperation)
  /// 记一笔 from the built-in 记账本: an expense into the shared ledger.
  case logExpense(MiniAppExpenseInput)
  /// Takes back an expense 记账本 logged.
  case removeExpense(id: String)
  /// SF Symbols the page shows as `<i class="sym">`, as template images.
  case symbols([String])
  /// An uncaught error or rejection in the page.
  case error(String)

  /// - Parameter ledger: whether this app may reach the ledger (the built-in 记账本 only).
  public init(_ message: MiniAppJSON, ledger: Bool) throws(MiniAppInvalid) {
    guard message.jsonData.count <= MiniAppLimits.messageBytes else {
      throw MiniAppInvalid("the message is larger than 64 KB")
    }
    switch message["op"]?.string {
    case "ledger.add":
      guard ledger else { throw MiniAppInvalid("this app has no ledger") }
      self = .logExpense(try MiniAppExpenseInput(message["expense"]))
    case "ledger.remove":
      guard ledger else { throw MiniAppInvalid("this app has no ledger") }
      guard let id = message["id"]?.string, !id.isEmpty else {
        throw MiniAppInvalid("ledger.remove needs an id")
      }
      self = .removeExpense(id: id)
    case "symbols":
      let names = (message["names"]?.array ?? []).compactMap(\.string)
        .filter { (1...64).contains($0.count) }
      self = .symbols(Array(names.prefix(64)))
    case "error":
      self = .error(String((message["message"]?.string ?? "").prefix(600)))
    default:
      self = .change(try MiniAppOperation(json: message))
    }
  }
}

/// An expense the 记账本 page logs: what the person typed. Atd adds the currency, the book and
/// the time.
public struct MiniAppExpenseInput: Sendable, Equatable {
  public var amount: Decimal
  public var category: ExpenseCategory
  public var note: String?

  public init(amount: Decimal, category: ExpenseCategory, note: String?) {
    self.amount = amount
    self.category = category
    self.note = note
  }

  init(_ json: MiniAppJSON?) throws(MiniAppInvalid) {
    let amount: Decimal? =
      switch json?["amount"] {
      case .string(let text)?: Decimal(string: text, locale: Locale(identifier: "en_US_POSIX"))
      case .number(let number)? where number.isFinite: Decimal(string: "\(number)")
      default: nil
      }
    guard let amount, amount > 0, amount < 1_000_000 else {
      throw MiniAppInvalid("the amount must be a number above 0 and below 1,000,000")
    }
    let category = json?["category"]?.string.flatMap(ExpenseCategory.init(rawValue:)) ?? .other
    let note = json?["note"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines)
    self.init(
      amount: amount, category: category,
      note: note.flatMap { $0.isEmpty ? nil : String($0.prefix(40)) })
  }

  public func draft(currency: String, book: String, date: Date) -> ExpenseDraft {
    ExpenseDraft(
      amount: amount, currency: currency, category: category, date: date, book: book, note: note)
  }
}

/// What a page sees of its app: `atd.data`, `atd.stats` (each daily field's numbers, counted
/// against the widget's goal when the widget draws that series), `atd.today` and, for 记账本,
/// `atd.ledger`.
public enum MiniAppSnapshot {
  public static func json(
    manifest: MiniAppManifest, data: MiniAppData, ledger: Ledger?, now: Date = .now,
    locale: Locale = .current, calendar: Calendar = .current
  ) -> MiniAppJSON {
    let days = MiniAppDay.calendar(timeZone: calendar.timeZone)
    let bound = manifest.widget.goalSeries
    var stats: [String: MiniAppJSON] = [:]
    for field in manifest.schema.fields where field.kind == .daily {
      let goal = bound?.series == field.name ? bound?.goal?.value(in: data) : nil
      stats[field.name] =
        MiniAppSeriesStats(
          series: data.series(field.name), goal: goal, now: now, calendar: days, locale: locale
        ).json
    }
    var snapshot: [String: MiniAppJSON] = [
      "data": .object(data.values), "stats": .object(stats),
      "today": .string(MiniAppDay.key(now, calendar: days)),
    ]
    if manifest.schema.ledger, let ledger {
      snapshot["ledger"] = MiniAppLedgerSummary(
        ledger: ledger, now: now, calendar: calendar, locale: locale
      ).json(now: now, locale: locale, calendar: calendar)
    }
    return .object(snapshot)
  }
}

/// At most `rate` changes a second, with a burst of as many: enough for any person tapping, not
/// for a page writing in a loop.
public struct MiniAppRateLimit: Sendable {
  public let rate: Double
  private var tokens: Double
  private var last: Date

  public init(rate: Double = 30, now: Date = .now) {
    self.rate = rate
    tokens = rate
    last = now
  }

  public mutating func take(now: Date = .now) -> Bool {
    tokens = min(rate, tokens + now.timeIntervalSince(last) * rate)
    last = now
    guard tokens >= 1 else { return false }
    tokens -= 1
    return true
  }
}

extension MiniAppJSON {
  /// A message body as WebKit hands it over (`NSDictionary`, `NSArray`, `NSString`,
  /// `NSNumber`, `NSNull`); nil for anything JSON cannot hold.
  public init?(foundation value: Any) {
    switch value {
    case is NSNull:
      self = .null
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        self = .bool(number.boolValue)
      } else {
        guard number.doubleValue.isFinite else { return nil }
        self = .number(number.doubleValue)
      }
    case let text as String:
      self = .string(text)
    case let array as [Any]:
      var items: [MiniAppJSON] = []
      for item in array {
        guard let json = MiniAppJSON(foundation: item) else { return nil }
        items.append(json)
      }
      self = .array(items)
    case let object as [String: Any]:
      var items: [String: MiniAppJSON] = [:]
      for (key, item) in object {
        guard let json = MiniAppJSON(foundation: item) else { return nil }
        items[key] = json
      }
      self = .object(items)
    default:
      return nil
    }
  }
}
