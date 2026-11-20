import AtdModel
import Foundation

/// A record of a list field: its fields by name, and the `id` Atd gave it.
public typealias MiniAppRecord = [String: MiniAppJSON]

extension Dictionary where Key == String, Value == MiniAppJSON {
  /// The id Atd gave the record.
  public var recordID: String? { self["id"]?.string }
}

/// A mini app's stored values (`mini-apps/<id>/data.json`), shared by the app's page and the
/// widget extension's buttons. The body is plain JSON by field name; `MiniAppData` reads it
/// through the schema.
public struct MiniAppDataFile: SharedDocument {
  public static let fileName = "data.json"
  public static let schemaVersion = 1

  public var values: [String: MiniAppJSON]

  public init(values: [String: MiniAppJSON]) {
    self.values = values
  }

  public static func initial() -> MiniAppDataFile {
    MiniAppDataFile(values: [:])
  }
}

/// A mini app's values read through its schema: every field present and valid. A stored value
/// that no longer fits (edited by hand, or written by a build with other limits) reads as the
/// field's default instead of failing the whole app.
public struct MiniAppData: Sendable, Equatable {
  public internal(set) var values: [String: MiniAppJSON]

  public init(schema: MiniAppSchema, stored: [String: MiniAppJSON]) {
    var values: [String: MiniAppJSON] = [:]
    for field in schema.fields {
      values[field.name] = Self.repaired(stored[field.name], for: field)
    }
    self.values = values
  }

  /// A new app's values: each field's default, then the model's `initial` values on top. List
  /// records get their ids here.
  public static func initial(
    schema: MiniAppSchema, initial: [String: MiniAppJSON]?,
    newID: () -> String = MiniAppData.newRecordID
  ) throws(MiniAppInvalid) -> MiniAppData {
    var data = MiniAppData(schema: schema, stored: [:])
    for (name, value) in initial ?? [:] {
      guard let field = schema.field(name) else {
        throw MiniAppInvalid("initial value for unknown field \(name)")
      }
      switch field.kind {
      case .list:
        guard let records = value.array, records.count <= field.capacity else {
          throw MiniAppInvalid(
            "initial \(name) must be a list of at most \(field.capacity) records")
        }
        var list: [MiniAppJSON] = []
        for record in records {
          guard let record = record.object else {
            throw MiniAppInvalid("initial \(name) holds something that is not a record")
          }
          list.append(.object(try field.record(record, id: newID())))
        }
        data.values[name] = .array(list)
      case .daily:
        throw MiniAppInvalid("daily field \(name) starts empty; give it no initial value")
      default:
        guard field.accepts(value) else {
          throw MiniAppInvalid("initial \(name) does not fit a \(field.kind.rawValue) field")
        }
        data.values[name] = value
      }
    }
    return data
  }

  /// A short random id for a new record.
  public static func newRecordID() -> String {
    String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(10)).lowercased()
  }

  public func number(_ name: String) -> Double? { values[name]?.number }
  public func text(_ name: String) -> String? { values[name]?.string }
  public func bool(_ name: String) -> Bool? { values[name]?.bool }
  public func day(_ name: String) -> String? { values[name]?.string }

  /// A daily field's values by day key (`2026-11-21`).
  public func series(_ name: String) -> [String: Double] {
    (values[name]?.object ?? [:]).compactMapValues(\.number)
  }

  /// A list field's records, in the order they were added.
  public func records(_ name: String) -> [MiniAppRecord] {
    (values[name]?.array ?? []).compactMap(\.object)
  }

  /// The stored value as the field reads it: kept when it fits, otherwise the default. Daily
  /// values outside the limits and records that are not records are dropped.
  static func repaired(_ stored: MiniAppJSON?, for field: MiniAppField) -> MiniAppJSON {
    switch field.kind {
    case .daily:
      guard let days = stored?.object else { return .object([:]) }
      let kept = days.filter { day, value in
        guard MiniAppDay.isValid(day), let number = value.number, number.isFinite else {
          return false
        }
        return number >= (field.min ?? -.infinity) && number <= (field.max ?? .infinity)
      }
      return .object(kept)
    case .list:
      guard let records = stored?.array else { return .array([]) }
      let kept = records.compactMap { record -> MiniAppJSON? in
        guard let record = record.object, let id = record.recordID, !id.isEmpty else { return nil }
        return .object(field.repairedRecord(record, id: id))
      }
      return .array(Array(kept.prefix(field.capacity)))
    default:
      if let stored, field.accepts(stored) { return stored }
      return field.initialValue
    }
  }
}

extension MiniAppField {
  /// A record checked strictly against the list's fields (unknown keys and values that do not
  /// fit are refused); missing fields take their defaults.
  func record(_ given: MiniAppRecord, id: String) throws(MiniAppInvalid) -> MiniAppRecord {
    let recordFields = fields ?? []
    for key in given.keys where key != "id" && !recordFields.contains(where: { $0.name == key }) {
      throw MiniAppInvalid("\(name) records have no field \(key)")
    }
    var record: MiniAppRecord = ["id": .string(id)]
    for field in recordFields {
      if let value = given[field.name], value != .null || field.kind == .date {
        guard field.accepts(value) else {
          throw MiniAppInvalid("\(name).\(field.name) does not fit a \(field.kind.rawValue) field")
        }
        record[field.name] = value
      } else {
        record[field.name] = field.initialValue
      }
    }
    return record
  }

  /// A stored record with every field present and valid.
  func repairedRecord(_ stored: MiniAppRecord, id: String) -> MiniAppRecord {
    var record: MiniAppRecord = ["id": .string(id)]
    for field in fields ?? [] {
      record[field.name] = MiniAppData.repaired(stored[field.name], for: field)
    }
    return record
  }
}

/// Days as mini apps store them: `yyyy-MM-dd` in the Gregorian calendar and the device's time
/// zone, so a day's key is the same whatever calendar the person reads dates in.
public enum MiniAppDay {
  /// The calendar day keys are counted in: Gregorian, in the current time zone.
  public static func calendar(timeZone: TimeZone = .current) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    return calendar
  }

  public static func key(_ date: Date, calendar: Calendar) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// The start of the day a key names; nil for anything that is not a real day.
  public static func date(_ key: String, calendar: Calendar) -> Date? {
    let parts = key.split(separator: "-", omittingEmptySubsequences: false)
    guard key.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2,
      parts[2].count == 2, let year = Int(parts[0]), let month = Int(parts[1]),
      let day = Int(parts[2]),
      let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
      self.key(date, calendar: calendar) == key
    else { return nil }
    return date
  }

  public static func isValid(_ key: String) -> Bool {
    date(key, calendar: calendar(timeZone: .gmt)) != nil
  }
}
