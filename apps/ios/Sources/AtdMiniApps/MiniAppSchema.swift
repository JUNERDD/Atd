import Foundation

/// One piece of a mini app's data, as the model declared it. A page reads it as
/// `atd.data.<name>`; widget templates bind to it by name.
///
/// Kinds: `number` (`default`, `min`, `max`, `step`), `text` (`default`, `max` characters),
/// `bool` (`default`), `date` (a day, `yyyy-MM-dd`, `default`), `daily` (one number per local day,
/// `min`, `max`, `step`) and `list` (records of `number`, `text`, `bool` and `date` fields, at most
/// `max` of them; Atd gives each record an `id`).
public struct MiniAppField: Sendable, Hashable, Codable {
  public enum Kind: String, Sendable, Hashable, Codable, CaseIterable {
    case number, text, bool, date, daily, list

    /// The kinds a list's records may hold.
    public var isScalar: Bool { self != .daily && self != .list }
  }

  public var name: String
  public var kind: Kind
  /// The value a new app starts with and a broken stored value falls back to.
  public var defaultValue: MiniAppJSON?
  public var min: Double?
  /// The largest number (`number`, `daily`), the most characters (`text`) or the most records
  /// (`list`).
  public var max: Double?
  public var step: Double?
  /// A list's record fields.
  public var fields: [MiniAppField]?

  public init(
    _ name: String, _ kind: Kind, defaultValue: MiniAppJSON? = nil, min: Double? = nil,
    max: Double? = nil, step: Double? = nil, fields: [MiniAppField]? = nil
  ) {
    self.name = name
    self.kind = kind
    self.defaultValue = defaultValue
    self.min = min
    self.max = max
    self.step = step
    self.fields = fields
  }

  private enum CodingKeys: String, CodingKey {
    case name, kind, min, max, step, fields
    case defaultValue = "default"
  }

  /// The most characters a text holds, or records a list holds: `max`, 200 when it gives none.
  var capacity: Int {
    let limit = kind == .list ? MiniAppLimits.records : MiniAppLimits.textLength
    guard let max, max.isFinite, max >= 1 else { return 200 }
    return Swift.min(Int(max), limit)
  }
}

/// The shape of a mini app's data: its fields, and whether it reads the shared expense ledger,
/// which only the built-in 记账本 may (`ledger`).
public struct MiniAppSchema: Sendable, Hashable, Codable {
  public var fields: [MiniAppField]
  /// The page gets `atd.ledger`. Never accepted from the model.
  public var ledger: Bool

  public init(fields: [MiniAppField], ledger: Bool = false) {
    self.fields = fields
    self.ledger = ledger
  }

  private enum CodingKeys: String, CodingKey {
    case fields, ledger
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    fields = try container.decode([MiniAppField].self, forKey: .fields)
    ledger = try container.decodeIfPresent(Bool.self, forKey: .ledger) ?? false
  }

  public func field(_ name: String) -> MiniAppField? {
    fields.first { $0.name == name }
  }

  /// Checks names, kinds, limits and defaults.
  public func validate() throws(MiniAppInvalid) {
    guard fields.count <= MiniAppLimits.fields else {
      throw MiniAppInvalid("more than \(MiniAppLimits.fields) fields")
    }
    try Self.validate(fields, inList: false)
  }

  /// Whether this schema can replace `older` without losing what is stored: every field stays,
  /// with its kind, and limits only widen. 改一改 may add fields, never remove or retype them.
  public func check(replacing older: MiniAppSchema) throws(MiniAppInvalid) {
    guard ledger == older.ledger else { throw MiniAppInvalid("the ledger access cannot change") }
    try Self.check(fields, replacing: older.fields, path: "")
  }

  private static func check(_ fields: [MiniAppField], replacing older: [MiniAppField], path: String)
    throws(MiniAppInvalid)
  {
    for old in older {
      guard let new = fields.first(where: { $0.name == old.name }) else {
        throw MiniAppInvalid("field \(path)\(old.name) was removed; keep every existing field")
      }
      guard new.kind == old.kind else {
        throw MiniAppInvalid("field \(path)\(old.name) changed kind; keep it \(old.kind.rawValue)")
      }
      if let oldMin = old.min, (new.min ?? -.infinity) > oldMin {
        throw MiniAppInvalid("field \(path)\(old.name) raised its min; limits may only widen")
      }
      if new.kind == .text || new.kind == .list {
        if new.capacity < old.capacity {
          throw MiniAppInvalid("field \(path)\(old.name) lowered its max; limits may only widen")
        }
      } else if let oldMax = old.max, (new.max ?? .infinity) < oldMax {
        throw MiniAppInvalid("field \(path)\(old.name) lowered its max; limits may only widen")
      }
      if old.kind == .list {
        try check(new.fields ?? [], replacing: old.fields ?? [], path: "\(path)\(old.name).")
      }
    }
  }

  private static func validate(_ fields: [MiniAppField], inList: Bool) throws(MiniAppInvalid) {
    var names = Set<String>()
    for field in fields {
      guard isValidName(field.name), !(inList && field.name == "id") else {
        throw MiniAppInvalid("field name \(field.name) is not a lowerCamelCase name (or is id)")
      }
      guard names.insert(field.name).inserted else {
        throw MiniAppInvalid("field \(field.name) is declared twice")
      }
      if inList, !field.kind.isScalar {
        throw MiniAppInvalid("list record field \(field.name) must be number, text, bool or date")
      }
      for bound in [field.min, field.max, field.step].compactMap({ $0 }) where !bound.isFinite {
        throw MiniAppInvalid("field \(field.name) has a limit that is not a number")
      }
      if let min = field.min, let max = field.max, min > max {
        throw MiniAppInvalid("field \(field.name) has min above max")
      }
      if let step = field.step, step <= 0 {
        throw MiniAppInvalid("field \(field.name) has a step of zero or less")
      }
      if let value = field.defaultValue, value != .null {
        guard field.kind.isScalar, field.accepts(value) else {
          throw MiniAppInvalid("field \(field.name) has a default that does not fit its kind")
        }
      }
      if field.kind == .list {
        let records = field.fields ?? []
        guard !records.isEmpty, records.count <= 16 else {
          throw MiniAppInvalid("list \(field.name) needs 1 to 16 record fields")
        }
        try validate(records, inList: true)
      }
    }
  }

  /// `^[a-z][a-zA-Z0-9]{0,31}$`
  static func isValidName(_ name: String) -> Bool {
    guard let first = name.unicodeScalars.first, (1...32).contains(name.count),
      CharacterSet.lowercaseASCII.contains(first)
    else { return false }
    return name.unicodeScalars.allSatisfy { CharacterSet.asciiAlphanumerics.contains($0) }
  }
}

extension MiniAppField {
  /// Whether `value` is a valid value of this scalar field as it stands (not repaired).
  func accepts(_ value: MiniAppJSON) -> Bool {
    switch (kind, value) {
    case (.number, .number(let number)):
      number.isFinite && number >= (min ?? -.infinity) && number <= (max ?? .infinity)
    case (.text, .string(let text)): text.count <= capacity
    case (.bool, .bool): true
    case (.date, .string(let day)): MiniAppDay.isValid(day)
    case (.date, .null): true
    default: false
    }
  }

  /// The value a new app starts with.
  var initialValue: MiniAppJSON {
    if let defaultValue, defaultValue != .null, accepts(defaultValue) { return defaultValue }
    switch kind {
    case .number: return .number(Swift.min(max ?? .infinity, Swift.max(min ?? -.infinity, 0)))
    case .text: return .string("")
    case .bool: return .bool(false)
    case .date: return .null
    case .daily: return .object([:])
    case .list: return .array([])
    }
  }
}

extension CharacterSet {
  fileprivate static let lowercaseASCII = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz")
  fileprivate static let asciiAlphanumerics = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
}
