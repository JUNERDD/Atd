import Foundation

/// Which of Atd's native widget templates a mini app's widget uses, bound to its data by field
/// name. The model writes this, never widget code: the widget extension draws the template from
/// the data (`MiniAppGlance`), so a tap on its button or a new day changes the widget without
/// running the page.
///
/// Templates (JSON `template`): `counter` (today's value of a daily series against a goal, with
/// a button that adds `step`), `streak` (days in a row), `checklist` (records ticked off, rows
/// tick in place), `ledger` (the shared expense ledger; built-in 记账本 only), `stat` (one
/// number) and `list` (the latest records).
public enum MiniAppWidgetSpec: Sendable, Equatable {
  case counter(Counter)
  case streak(Streak)
  case checklist(Checklist)
  case ledger
  case stat(Stat)
  case list(Rows)

  public struct Counter: Sendable, Equatable {
    public var series: String
    public var goal: MiniAppAmount?
    public var unit: String
    /// What the widget's button adds.
    public var step: Double
    /// The button's label (`1 杯`); the step and unit when nil.
    public var button: String?
  }

  public struct Streak: Sendable, Equatable {
    public var series: String
    /// A day counts when it reaches the goal; without one, when it has anything above 0.
    public var goal: MiniAppAmount?
    public var unit: String
    /// What the streak is (连续读书).
    public var kicker: String
  }

  public struct Checklist: Sendable, Equatable {
    public var list: String
    /// The records' bool field that ticks them off.
    public var done: String
    /// The records' text field the rows show.
    public var label: String
    /// What the count is (已打包).
    public var kicker: String?
    /// What comes before the next unticked label (下一件).
    public var next: String?
    /// What shows once every record is ticked (都装好了).
    public var finished: String?
  }

  public struct Stat: Sendable, Equatable {
    public var value: MiniAppStatValue
    public var unit: String?
    public var kicker: String
    /// A daily series drawn as the last seven days' bars.
    public var bars: String?
  }

  public struct Rows: Sendable, Equatable {
    public var list: String
    /// The records' field each row is titled with.
    public var title: String
    /// The records' field shown at the end of each row.
    public var trailing: String?
    public var kicker: String?
  }

  /// The daily series the widget's goal applies to, so pages read the same streak.
  public var goalSeries: (series: String, goal: MiniAppAmount?)? {
    switch self {
    case .counter(let counter): (counter.series, counter.goal)
    case .streak(let streak): (streak.series, streak.goal)
    default: nil
    }
  }
}

/// A goal: a number field the page can change, or a fixed number.
public enum MiniAppAmount: Sendable, Equatable {
  case field(String)
  case literal(Double)

  public func value(in data: MiniAppData) -> Double? {
    switch self {
    case .field(let name): data.number(name)
    case .literal(let value): value
    }
  }
}

/// The number a `stat` widget shows.
public enum MiniAppStatValue: Sendable, Equatable {
  /// A number field as it stands.
  case field(String)
  /// Part of a daily series' stats.
  case series(String, MiniAppStatPart)
  /// Days until the day a date field holds.
  case daysUntil(String)
}

public enum MiniAppStatPart: String, Sendable, Equatable, CaseIterable {
  case today, week, month, total, streak
}

extension MiniAppWidgetSpec {
  /// Reads the model's widget section and checks it against the data's fields.
  public init(json: MiniAppJSON, schema: MiniAppSchema) throws(MiniAppInvalid) {
    self = try Self(json: json)
    try validate(against: schema)
  }

  init(json: MiniAppJSON) throws(MiniAppInvalid) {
    guard let template = json["template"]?.string else {
      throw MiniAppInvalid("the widget needs a template")
    }
    func name(_ key: String) throws(MiniAppInvalid) -> String {
      guard let value = json[key]?.string, !value.isEmpty else {
        throw MiniAppInvalid("the \(template) widget needs \(key)")
      }
      return value
    }
    func optionalName(_ key: String) -> String? {
      json[key]?.string.flatMap { $0.isEmpty ? nil : $0 }
    }
    func label(_ key: String) throws(MiniAppInvalid) -> String? {
      guard let value = json[key], value != .null else { return nil }
      guard let text = value.string?.trimmingCharacters(in: .whitespacesAndNewlines),
        text.count <= MiniAppLimits.labelLength
      else { throw MiniAppInvalid("widget \(key) must be text of at most 16 characters") }
      return text.isEmpty ? nil : text
    }
    func goal() throws(MiniAppInvalid) -> MiniAppAmount? {
      switch json["goal"] {
      case .string(let field)?: return .field(field)
      case .number(let value)? where value > 0 && value.isFinite: return .literal(value)
      case nil, .null?: return nil
      default: throw MiniAppInvalid("widget goal must be a number field's name or a number above 0")
      }
    }
    switch template {
    case "counter":
      let step = json["step"]?.number ?? 1
      guard step > 0, step.isFinite else { throw MiniAppInvalid("counter step must be above 0") }
      self = .counter(
        Counter(
          series: try name("series"), goal: try goal(), unit: try label("unit") ?? "", step: step,
          button: try label("button")))
    case "streak":
      self = .streak(
        Streak(
          series: try name("series"), goal: try goal(), unit: try label("unit") ?? "",
          kicker: try label("kicker") ?? ""))
    case "checklist":
      self = .checklist(
        Checklist(
          list: try name("list"), done: try name("done"), label: try name("label"),
          kicker: try label("kicker"), next: try label("next"), finished: try label("finished")))
    case "ledger":
      self = .ledger
    case "stat":
      self = .stat(
        Stat(
          value: try Self.statValue(json["value"]), unit: try label("unit"),
          kicker: try label("kicker") ?? "", bars: optionalName("bars")))
    case "list":
      self = .list(
        Rows(
          list: try name("list"), title: try name("title"), trailing: optionalName("trailing"),
          kicker: try label("kicker")))
    default:
      throw MiniAppInvalid("unknown widget template \(template)")
    }
  }

  private static func statValue(_ json: MiniAppJSON?) throws(MiniAppInvalid) -> MiniAppStatValue {
    switch json {
    case .string(let field)?:
      return .field(field)
    case .object(let object)?:
      if let series = object["series"]?.string {
        guard let part = MiniAppStatPart(rawValue: object["of"]?.string ?? "today") else {
          throw MiniAppInvalid("stat of must be today, week, month, total or streak")
        }
        return .series(series, part)
      }
      if let field = object["daysUntil"]?.string { return .daysUntil(field) }
      throw MiniAppInvalid("stat value needs series or daysUntil")
    default:
      throw MiniAppInvalid("stat value must be a number field's name or an object")
    }
  }

  /// Checks that every binding names a field of the right kind.
  public func validate(against schema: MiniAppSchema) throws(MiniAppInvalid) {
    func goal(_ amount: MiniAppAmount?) throws(MiniAppInvalid) {
      if case .field(let name)? = amount { _ = try schema.existing(name, kinds: [.number]) }
    }
    func recordField(_ list: MiniAppField, _ name: String, _ kinds: Set<MiniAppField.Kind>)
      throws(MiniAppInvalid)
    {
      guard let field = list.fields?.first(where: { $0.name == name }), kinds.contains(field.kind)
      else {
        let expected = kinds.map(\.rawValue).sorted().joined(separator: " or ")
        throw MiniAppInvalid("\(list.name) records need a \(expected) field \(name)")
      }
    }
    switch self {
    case .counter(let counter):
      _ = try schema.existing(counter.series, kinds: [.daily])
      try goal(counter.goal)
    case .streak(let streak):
      _ = try schema.existing(streak.series, kinds: [.daily])
      try goal(streak.goal)
    case .checklist(let checklist):
      let list = try schema.existing(checklist.list, kinds: [.list])
      try recordField(list, checklist.done, [.bool])
      try recordField(list, checklist.label, [.text])
    case .ledger:
      guard schema.ledger else { throw MiniAppInvalid("only 记账本 can show the ledger") }
    case .stat(let stat):
      switch stat.value {
      case .field(let name): _ = try schema.existing(name, kinds: [.number])
      case .series(let name, _): _ = try schema.existing(name, kinds: [.daily])
      case .daysUntil(let name): _ = try schema.existing(name, kinds: [.date])
      }
      if let bars = stat.bars { _ = try schema.existing(bars, kinds: [.daily]) }
    case .list(let rows):
      let list = try schema.existing(rows.list, kinds: [.list])
      try recordField(list, rows.title, [.text])
      if let trailing = rows.trailing { try recordField(list, trailing, [.number, .text, .date]) }
    }
  }
}
