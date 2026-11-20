import AtdMiniApps
import Foundation
import Testing

/// Shanghai has no daylight saving time; `Fixture.newYork` covers a day 25 hours long.
enum Fixture {
  static let shanghai = MiniAppDay.calendar(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
  static let newYork = MiniAppDay.calendar(timeZone: TimeZone(identifier: "America/New_York")!)

  /// Noon on 2026-11-`day` in Shanghai.
  static func day(_ day: Int, hour: Int = 12, calendar: Calendar = shanghai) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour))!
  }

  /// A context whose new records are numbered r1, r2, …
  static func context(today: String = "2026-11-21") -> MiniAppChangeContext {
    let counter = Counter()
    return MiniAppChangeContext(today: today) { "r\(counter.next())" }
  }

  static let reading = MiniAppSchema(fields: [
    MiniAppField("goal", .number, defaultValue: 20, min: 1, max: 500, step: 1),
    MiniAppField("pages", .daily, min: 0, max: 2_000, step: 5),
    MiniAppField("title", .text, max: 40),
    MiniAppField("finished", .bool),
    MiniAppField("due", .date),
    MiniAppField(
      "books", .list, max: 3,
      fields: [MiniAppField("name", .text, max: 30), MiniAppField("done", .bool)]),
  ])
}

final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func next() -> Int {
    lock.withLock {
      value += 1
      return value
    }
  }
}

@Suite struct MiniAppSchemaTests {
  @Test func theFixtureIsValid() throws {
    try Fixture.reading.validate()
  }

  @Test(arguments: [
    MiniAppField("Pages", .number), MiniAppField("1pages", .number),
    MiniAppField("page count", .number), MiniAppField(String(repeating: "a", count: 33), .number),
    MiniAppField("goal", .number, min: 5, max: 1), MiniAppField("goal", .number, step: 0),
    MiniAppField("goal", .number, defaultValue: "eight"),
    MiniAppField("items", .list, fields: []),
    MiniAppField("items", .list, fields: [MiniAppField("id", .text)]),
    MiniAppField("items", .list, fields: [MiniAppField("days", .daily)]),
  ])
  func fieldsThatCannotBeStoredAreRefused(_ field: MiniAppField) {
    #expect(throws: MiniAppInvalid.self) { try MiniAppSchema(fields: [field]).validate() }
  }

  @Test func namesAreUniqueAndFieldsLimited() {
    let twice = MiniAppSchema(fields: [MiniAppField("a", .number), MiniAppField("a", .text)])
    #expect(throws: MiniAppInvalid.self) { try twice.validate() }
    let many = MiniAppSchema(fields: (0...32).map { MiniAppField("f\($0)", .number) })
    #expect(throws: MiniAppInvalid.self) { try many.validate() }
  }

  @Test func aRefinementKeepsEveryFieldAndOnlyWidensLimits() throws {
    var wider = Fixture.reading
    wider.fields.append(MiniAppField("note", .text))
    wider.fields[0].max = 1_000
    try wider.check(replacing: Fixture.reading)

    var removed = Fixture.reading
    removed.fields.removeAll { $0.name == "title" }
    #expect(throws: MiniAppInvalid.self) { try removed.check(replacing: Fixture.reading) }
    var retyped = Fixture.reading
    retyped.fields[2].kind = .number
    #expect(throws: MiniAppInvalid.self) { try retyped.check(replacing: Fixture.reading) }
    var narrower = Fixture.reading
    narrower.fields[5].max = 2
    #expect(throws: MiniAppInvalid.self) { try narrower.check(replacing: Fixture.reading) }
    var ledger = Fixture.reading
    ledger.ledger = true
    #expect(throws: MiniAppInvalid.self) { try ledger.check(replacing: Fixture.reading) }
  }
}

@Suite struct MiniAppDataTests {
  @Test func aNewAppStartsFromDefaultsAndItsInitialValues() throws {
    let counter = Counter()
    let data = try MiniAppData.initial(
      schema: Fixture.reading,
      initial: ["title": "Dune", "books": [["name": "Dune"], ["name": "Emma", "done": true]]]
    ) { "b\(counter.next())" }
    #expect(data.number("goal") == 20)
    #expect(data.text("title") == "Dune")
    #expect(data.bool("finished") == false)
    #expect(data.series("pages").isEmpty)
    #expect(
      data.records("books") == [
        ["id": "b1", "name": "Dune", "done": false], ["id": "b2", "name": "Emma", "done": true],
      ])
  }

  @Test(arguments: [
    ["pages": ["2026-11-20": 30]] as [String: MiniAppJSON], ["missing": 1], ["goal": "twenty"],
    ["books": [["name": "A"], ["name": "B"], ["name": "C"], ["name": "D"]]],
    ["books": [["author": "Herbert"]]],
  ])
  func initialValuesThatDoNotFitAreRefused(_ initial: [String: MiniAppJSON]) {
    #expect(throws: MiniAppInvalid.self) {
      try MiniAppData.initial(schema: Fixture.reading, initial: initial)
    }
  }

  @Test func storedValuesAreRepairedToTheSchema() {
    let data = MiniAppData(
      schema: Fixture.reading,
      stored: [
        "goal": 9_999, "pages": ["2026-11-20": 30, "yesterday": 5, "2026-11-19": "x"],
        "title": .number(3), "books": [["id": "a", "name": "Dune", "extra": 1], "junk"],
      ])
    #expect(data.number("goal") == 20)
    #expect(data.series("pages") == ["2026-11-20": 30])
    #expect(data.text("title") == "")
    #expect(data.records("books") == [["id": "a", "name": "Dune", "done": false]])
  }

  @Test func everyChangeHasAnUndo() throws {
    let schema = Fixture.reading
    let original = try MiniAppData.initial(
      schema: schema, initial: ["books": [["name": "Dune"]]]
    ) { "b1" }
    var data = original
    let context = Fixture.context()
    let changes: [MiniAppOperation] = [
      .set(field: "goal", value: 30), .set(field: "due", value: "2026-12-01"),
      .add(field: "pages", amount: 15, day: nil), .add(field: "pages", amount: 10, day: nil),
      .put(field: "pages", value: 40, day: "2026-11-19"),
      .insert(list: "books", record: ["name": "Emma"]),
      .update(list: "books", id: "b1", changes: ["done": true]),
      .remove(list: "books", id: "b1"),
    ]
    let undo = try data.apply(changes, schema: schema, context: context)
    #expect(data.number("goal") == 30 && data.day("due") == "2026-12-01")
    #expect(data.series("pages") == ["2026-11-21": 25, "2026-11-19": 40])
    #expect(data.records("books") == [["id": "r1", "name": "Emma", "done": false]])
    try data.apply(undo, schema: schema, context: context)
    #expect(data == original)
  }

  @Test func aBatchWithOneBadChangeChangesNothing() throws {
    var data = MiniAppData(schema: Fixture.reading, stored: [:])
    let before = data
    #expect(throws: MiniAppInvalid.self) {
      try data.apply(
        [.set(field: "goal", value: 30), .set(field: "goal", value: 0)],
        schema: Fixture.reading, context: Fixture.context())
    }
    #expect(data == before)
  }

  @Test(arguments: [
    MiniAppOperation.set(field: "pages", value: 3), .set(field: "nothing", value: 1),
    .set(field: "title", value: .string(String(repeating: "x", count: 41))),
    .set(field: "due", value: "2026-02-30"), .add(field: "goal", amount: 1, day: nil),
    .add(field: "pages", amount: 5, day: "2026-11-22"), .put(field: "pages", value: -5, day: nil),
    .put(field: "pages", value: 10, day: "21-11-2026"),
    .insert(list: "books", record: ["name": 3]), .update(list: "books", id: "none", changes: [:]),
    .update(list: "books", id: "b1", changes: ["id": "b2"]), .remove(list: "books", id: "none"),
  ])
  func changesTheFieldsRefuse(_ operation: MiniAppOperation) throws {
    var data = try MiniAppData.initial(
      schema: Fixture.reading, initial: ["books": [["name": "Dune"]]]
    ) { "b1" }
    #expect(throws: MiniAppInvalid.self) {
      try data.apply(operation, schema: Fixture.reading, context: Fixture.context())
    }
  }

  @Test func dailyValuesStayWithinTheirLimitsAndAListWithinItsSize() throws {
    var data = MiniAppData(schema: Fixture.reading, stored: [:])
    let context = Fixture.context()
    try data.apply(
      .add(field: "pages", amount: 5_000, day: nil), schema: Fixture.reading, context: context)
    #expect(data.series("pages")["2026-11-21"] == 2_000)
    try data.apply(
      .add(field: "pages", amount: -9_000, day: nil), schema: Fixture.reading, context: context)
    #expect(data.series("pages").isEmpty)
    for name in ["A", "B", "C"] {
      try data.apply(
        .insert(list: "books", record: ["name": .string(name)]), schema: Fixture.reading,
        context: context)
    }
    #expect(throws: MiniAppInvalid.self) {
      try data.apply(.insert(list: "books", record: [:]), schema: Fixture.reading, context: context)
    }
  }

  @Test func pagesSendChangesAsJSON() throws {
    let json = try #require(
      MiniAppJSON.parse(#"{"op": "add", "field": "pages", "amount": 5, "day": null}"#))
    #expect(try MiniAppOperation(json: json) == .add(field: "pages", amount: 5, day: nil))
    let insert = try #require(
      MiniAppJSON.parse(#"{"op": "insert", "list": "books", "record": {"name": "Dune"}}"#))
    #expect(try MiniAppOperation(json: insert) == .insert(list: "books", record: ["name": "Dune"]))
    for text in [#"{"op": "drop"}"#, #"{"op": "set"}"#, #"{"op": "add", "field": "pages"}"#] {
      let json = try #require(MiniAppJSON.parse(text))
      #expect(throws: MiniAppInvalid.self) { try MiniAppOperation(json: json) }
    }
  }
}

@Suite struct MiniAppStatsTests {
  private let now = Fixture.day(21)

  @Test func aStreakCountsDaysInARowThatReachTheGoal() {
    let series: [String: Double] = [
      "2026-11-21": 30, "2026-11-20": 20, "2026-11-19": 25, "2026-11-18": 5, "2026-11-17": 40,
      "2026-10-31": 10,
    ]
    let stats = MiniAppSeriesStats(
      series: series, goal: 20, now: now, calendar: Fixture.shanghai,
      locale: Locale(identifier: "en_US"))
    #expect(stats.today == 30 && stats.doneToday)
    #expect(stats.streak == 3)
    #expect(stats.week == [0, 0, 40, 5, 25, 20, 30])
    #expect(stats.weekDone == [false, false, true, false, true, true, true])
    #expect(stats.weekLabels == ["S", "M", "T", "W", "T", "F", "S"])
    #expect(stats.month == 120 && stats.total == 130)
  }

  @Test func withoutAGoalAnyLoggedDayCounts() {
    let series: [String: Double] = ["2026-11-20": 1, "2026-11-19": 2]
    let stats = MiniAppSeriesStats(series: series, goal: nil, now: now, calendar: Fixture.shanghai)
    // Today is not logged yet: the streak still stands from yesterday.
    #expect(!stats.doneToday && stats.streak == 2)
  }

  @Test func daysAreCountedAcrossADaylightSavingChange() {
    // New York left daylight saving time on 2026-11-01.
    let now = Fixture.day(2, hour: 0, calendar: Fixture.newYork).addingTimeInterval(60)
    let series: [String: Double] = ["2026-11-02": 1, "2026-11-01": 1, "2026-10-31": 1]
    let stats = MiniAppSeriesStats(series: series, goal: nil, now: now, calendar: Fixture.newYork)
    #expect(stats.streak == 3)
    #expect(MiniAppDay.key(now, calendar: Fixture.newYork) == "2026-11-02")
  }

  @Test func daysUntilADate() {
    #expect(MiniAppDay.days(until: "2026-11-24", now: now, calendar: Fixture.shanghai) == 3)
    #expect(MiniAppDay.days(until: "2026-11-21", now: now, calendar: Fixture.shanghai) == 0)
    #expect(MiniAppDay.days(until: "not a day", now: now, calendar: Fixture.shanghai) == nil)
  }
}
