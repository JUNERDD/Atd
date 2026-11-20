import Foundation

/// One change to a mini app's data: what a page asks for through `window.atd`, what a widget
/// button does, and what 改一改 may do to existing data. Every change is checked against the
/// schema; applying one returns the change that undoes it.
public enum MiniAppOperation: Sendable, Equatable {
  /// Sets a number, text, bool or date field (`null` clears a date).
  case set(field: String, value: MiniAppJSON)
  /// Adds to a daily field's value for `day` (today when nil), kept within the field's limits.
  case add(field: String, amount: Double, day: String?)
  /// Sets a daily field's value for `day` (today when nil); nil clears the day.
  case put(field: String, value: Double?, day: String?)
  /// Adds a record to a list; Atd gives it a new id.
  case insert(list: String, record: MiniAppRecord)
  /// Changes some fields of the record with `id`.
  case update(list: String, id: String, changes: MiniAppRecord)
  /// Removes the record with `id`.
  case remove(list: String, id: String)
  /// Puts back, at `index`, a record `remove` took out (only as an undo).
  case restore(list: String, record: MiniAppRecord, index: Int)

  /// Reads a change a page or the model wrote: `{"op": "set", "field": …, "value": …}`,
  /// `{"op": "add", "field", "amount", "day"?}`, `{"op": "put", "field", "value", "day"?}`,
  /// `{"op": "insert", "list", "record"}`, `{"op": "update", "list", "id", "changes"}`,
  /// `{"op": "remove", "list", "id"}`.
  public init(json: MiniAppJSON) throws(MiniAppInvalid) {
    guard let op = json["op"]?.string else { throw MiniAppInvalid("a change needs an op") }
    func text(_ key: String) throws(MiniAppInvalid) -> String {
      guard let value = json[key]?.string, !value.isEmpty else {
        throw MiniAppInvalid("\(op) needs \(key)")
      }
      return value
    }
    func day() throws(MiniAppInvalid) -> String? {
      guard let value = json["day"], value != .null else { return nil }
      guard let day = value.string, MiniAppDay.isValid(day) else {
        throw MiniAppInvalid("day must be yyyy-MM-dd")
      }
      return day
    }
    switch op {
    case "set":
      self = .set(field: try text("field"), value: json["value"] ?? .null)
    case "add":
      guard let amount = json["amount"]?.number, amount.isFinite else {
        throw MiniAppInvalid("add needs a number amount")
      }
      self = .add(field: try text("field"), amount: amount, day: try day())
    case "put":
      let value = json["value"] ?? .null
      guard value == .null || value.number?.isFinite == true else {
        throw MiniAppInvalid("put needs a number value or null")
      }
      self = .put(field: try text("field"), value: value.number, day: try day())
    case "insert":
      guard let record = json["record"]?.object else {
        throw MiniAppInvalid("insert needs a record")
      }
      self = .insert(list: try text("list"), record: record)
    case "update":
      guard let changes = json["changes"]?.object else {
        throw MiniAppInvalid("update needs changes")
      }
      self = .update(list: try text("list"), id: try text("id"), changes: changes)
    case "remove":
      self = .remove(list: try text("list"), id: try text("id"))
    default:
      throw MiniAppInvalid("unknown op \(op)")
    }
  }
}

/// What a change needs besides the data: today's key and new record ids.
public struct MiniAppChangeContext: Sendable {
  public var today: String
  public var newID: @Sendable () -> String

  public init(today: String, newID: @escaping @Sendable () -> String = MiniAppData.newRecordID) {
    self.today = today
    self.newID = newID
  }

  public init(now: Date, calendar: Calendar = MiniAppDay.calendar()) {
    self.init(today: MiniAppDay.key(now, calendar: calendar))
  }
}

extension MiniAppData {
  /// Applies `operation` and returns the operation that undoes it. Nothing changes when it
  /// throws.
  @discardableResult
  public mutating func apply(
    _ operation: MiniAppOperation, schema: MiniAppSchema, context: MiniAppChangeContext
  ) throws(MiniAppInvalid) -> MiniAppOperation {
    switch operation {
    case .set(let name, let value):
      let field = try schema.existing(name, kinds: [.number, .text, .bool, .date])
      guard field.accepts(value) else {
        throw MiniAppInvalid("\(name) does not take \(value.jsonString)")
      }
      let old = values[name] ?? field.initialValue
      values[name] = value
      return .set(field: name, value: old)
    case .add(let name, let amount, let day):
      let field = try schema.existing(name, kinds: [.daily])
      let day = try validDay(day, context: context)
      var series = series(name)
      let old = series[day]
      let new = Swift.min(
        field.max ?? .infinity, Swift.max(field.min ?? -.infinity, (old ?? 0) + amount))
      series[day] = new == 0 ? nil : new
      store(series, in: name)
      return .put(field: name, value: old, day: day)
    case .put(let name, let value, let day):
      let field = try schema.existing(name, kinds: [.daily])
      let day = try validDay(day, context: context)
      if let value {
        guard value.isFinite, value >= (field.min ?? -.infinity), value <= (field.max ?? .infinity)
        else { throw MiniAppInvalid("\(name) does not take \(value)") }
      }
      var series = series(name)
      let old = series[day]
      series[day] = value
      store(series, in: name)
      return .put(field: name, value: old, day: day)
    case .insert(let name, let given):
      let field = try schema.existing(name, kinds: [.list])
      var list = records(name)
      guard list.count < field.capacity else { throw MiniAppInvalid("\(name) is full") }
      let record = try field.record(given, id: context.newID())
      list.append(record)
      values[name] = .array(list.map(MiniAppJSON.object))
      return .remove(list: name, id: record.recordID ?? "")
    case .update(let name, let id, let changes):
      let field = try schema.existing(name, kinds: [.list])
      var list = records(name)
      guard let index = list.firstIndex(where: { $0.recordID == id }) else {
        throw MiniAppInvalid("\(name) has no record \(id)")
      }
      guard changes["id"] == nil else { throw MiniAppInvalid("a record's id cannot change") }
      var merged = list[index]
      var previous: MiniAppRecord = [:]
      for (key, value) in changes {
        previous[key] = merged[key]
        merged[key] = value
      }
      list[index] = try field.record(merged, id: id)
      values[name] = .array(list.map(MiniAppJSON.object))
      return .update(list: name, id: id, changes: previous)
    case .remove(let name, let id):
      _ = try schema.existing(name, kinds: [.list])
      var list = records(name)
      guard let index = list.firstIndex(where: { $0.recordID == id }) else {
        throw MiniAppInvalid("\(name) has no record \(id)")
      }
      let record = list.remove(at: index)
      values[name] = .array(list.map(MiniAppJSON.object))
      return .restore(list: name, record: record, index: index)
    case .restore(let name, let record, let index):
      let field = try schema.existing(name, kinds: [.list])
      guard let id = record.recordID else { throw MiniAppInvalid("the record has no id") }
      var list = records(name)
      guard !list.contains(where: { $0.recordID == id }) else {
        throw MiniAppInvalid("\(name) already has record \(id)")
      }
      list.insert(try field.record(record, id: id), at: Swift.min(Swift.max(index, 0), list.count))
      values[name] = .array(list.map(MiniAppJSON.object))
      return .remove(list: name, id: id)
    }
  }

  /// Applies every operation, or none of them. Returns their undo, in the order to apply it.
  @discardableResult
  public mutating func apply(
    _ operations: [MiniAppOperation], schema: MiniAppSchema, context: MiniAppChangeContext
  ) throws(MiniAppInvalid) -> [MiniAppOperation] {
    var copy = self
    var undo: [MiniAppOperation] = []
    for operation in operations {
      undo.insert(try copy.apply(operation, schema: schema, context: context), at: 0)
    }
    self = copy
    return undo
  }

  private func validDay(_ day: String?, context: MiniAppChangeContext) throws(MiniAppInvalid)
    -> String
  {
    let day = day ?? context.today
    // Day keys compare in calendar order.
    guard MiniAppDay.isValid(day), day <= context.today else {
      throw MiniAppInvalid("day \(day) is not today or before")
    }
    return day
  }

  /// Keeps the most recent days only.
  private mutating func store(_ series: [String: Double], in name: String) {
    var series = series
    if series.count > MiniAppLimits.days {
      let kept = Set(series.keys.sorted().suffix(MiniAppLimits.days))
      series = series.filter { kept.contains($0.key) }
    }
    values[name] = .object(series.mapValues(MiniAppJSON.number))
  }
}

extension MiniAppSchema {
  /// The field `name`, which must be one of `kinds`.
  func existing(_ name: String, kinds: Set<MiniAppField.Kind>) throws(MiniAppInvalid)
    -> MiniAppField
  {
    guard let field = field(name) else { throw MiniAppInvalid("there is no field \(name)") }
    guard kinds.contains(field.kind) else {
      throw MiniAppInvalid("\(name) is a \(field.kind.rawValue) field")
    }
    return field
  }
}
