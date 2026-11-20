import AtdModel
import Foundation
import Testing

@testable import AtdMiniApps

@Suite struct MiniAppBridgeTests {
  private func request(_ text: String, ledger: Bool = false) throws -> MiniAppBridgeRequest {
    try MiniAppBridgeRequest(try #require(MiniAppJSON.parse(text)), ledger: ledger)
  }

  @Test func aPageChangesItsOwnData() throws {
    #expect(
      try request(#"{"op": "put", "field": "cups", "value": 3, "day": "2026-11-20"}"#)
        == .change(.put(field: "cups", value: 3, day: "2026-11-20")))
  }

  @Test func onlyTheLedgerAppReachesTheLedger() throws {
    let add = #"{"op": "ledger.add", "expense": {"amount": "46.5", "category": "dining"}}"#
    #expect(throws: MiniAppInvalid.self) { try request(add) }
    #expect(throws: MiniAppInvalid.self) { try request(#"{"op": "ledger.remove", "id": "e1"}"#) }
    let logged = try request(add, ledger: true)
    #expect(
      logged
        == .logExpense(
          MiniAppExpenseInput(amount: Decimal(string: "46.5")!, category: .dining, note: nil)))
    #expect(
      try request(#"{"op": "ledger.remove", "id": "e1"}"#, ledger: true) == .removeExpense(id: "e1")
    )
  }

  @Test(arguments: [
    #"{"amount": 0}"#, #"{"amount": -3}"#, #"{"amount": "abc"}"#, #"{"amount": 1000000}"#, "{}",
  ])
  func expensesNeedAnAmount(_ expense: String) {
    #expect(throws: MiniAppInvalid.self) {
      try request(#"{"op": "ledger.add", "expense": \#(expense)}"#, ledger: true)
    }
  }

  @Test func anExpenseTakesItsBookCurrencyAndTimeFromAtd() throws {
    let message =
      #"{"op": "ledger.add", "expense": {"amount": 12, "category": "taxi", "note": "  airport  "}}"#
    guard case .logExpense(let input) = try request(message, ledger: true) else {
      Issue.record("not an expense")
      return
    }
    #expect(input.category == .other && input.note == "airport")
    let now = Fixture.day(21)
    let draft = input.draft(currency: "CNY", book: "日常", date: now)
    #expect(
      draft.amount == 12 && draft.currency == "CNY" && draft.book == "日常" && draft.date == now)
  }

  @Test func symbolsAndErrorsAreBounded() throws {
    let names = (0..<80).map { "\"s\($0)\"" }.joined(separator: ",")
    guard case .symbols(let symbols) = try request(#"{"op": "symbols", "names": [\#(names), ""]}"#)
    else {
      Issue.record("not symbols")
      return
    }
    #expect(symbols.count == 64)
    let long = String(repeating: "x", count: 900)
    #expect(
      try request(#"{"op": "error", "message": "\#(long)"}"#) == .error(String(long.prefix(600))))
  }

  @Test func aMessageOver64KBIsRefused() {
    let text = String(repeating: "x", count: 70 * 1_024)
    #expect(throws: MiniAppInvalid.self) {
      try request(#"{"op": "set", "field": "title", "value": "\#(text)"}"#)
    }
  }

  @Test func aPageThatWritesInALoopIsSlowedDown() {
    let start = Fixture.day(21)
    var limit = MiniAppRateLimit(now: start)
    let burst = (0..<30).map { _ in limit.take(now: start) }
    let over = limit.take(now: start)
    let later = limit.take(now: start.addingTimeInterval(0.1))
    #expect(burst.allSatisfy { $0 } && !over && later)
  }

  @Test func webKitMessagesBecomeJSON() {
    let body: [String: Any] = [
      "op": "insert", "list": "items",
      "record": ["label": "Tent", "packed": NSNumber(value: true)],
      "count": NSNumber(value: 2), "nothing": NSNull(),
    ]
    #expect(
      MiniAppJSON(foundation: body)
        == [
          "op": "insert", "list": "items", "record": ["label": "Tent", "packed": true], "count": 2,
          "nothing": .null,
        ])
    #expect(MiniAppJSON(foundation: Date()) == nil)
  }
}

@Suite struct MiniAppSnapshotTests {
  private let now = Fixture.day(21)

  private var water: (app: MiniApp, package: MiniAppPackage) {
    MiniAppBuiltins.all(now: now)[1]
  }

  @Test func aPageSeesItsDataAndTheStatsTheWidgetCounts() throws {
    let (_, package) = water
    var data = MiniAppData(schema: package.manifest.schema, stored: [:])
    try data.apply(
      [
        .put(field: "cups", value: 8, day: "2026-11-21"),
        .put(field: "cups", value: 9, day: "2026-11-20"),
      ],
      schema: package.manifest.schema, context: Fixture.context())
    let snapshot = MiniAppSnapshot.json(
      manifest: package.manifest, data: data, ledger: Ledger(), now: now, calendar: Fixture.shanghai
    )
    #expect(snapshot["today"] == "2026-11-21")
    #expect(snapshot["data"]?["goal"] == 8)
    let cups = try #require(snapshot["stats"]?["cups"])
    #expect(cups["today"] == 8 && cups["doneToday"] == true && cups["streak"] == 2)
    // 喝水 does not read the ledger, even when one is passed.
    #expect(snapshot["ledger"] == nil)
  }

  @Test func theLedgerAppSeesTheMonth() throws {
    let (_, package) = MiniAppBuiltins.all(now: now)[0]
    let ledger = Ledger(expenses: [
      Expense(
        id: "e1", amount: 46.5, currency: "CNY", category: .dining, book: "日常", date: now,
        createdAt: now, source: .manual),
      Expense(
        id: "e2", amount: 20, currency: "CNY", category: .transport, book: "日常",
        date: Fixture.day(3), createdAt: Fixture.day(3), source: .camera),
    ])
    let snapshot = MiniAppSnapshot.json(
      manifest: package.manifest, data: MiniAppData(schema: package.manifest.schema, stored: [:]),
      ledger: ledger, now: now, locale: Locale(identifier: "zh_Hans_CN"), calendar: Fixture.shanghai
    )
    let summary = try #require(snapshot["ledger"])
    #expect(summary["currency"] == "CNY")
    #expect(summary["month"]?["amount"] == "66.5" && summary["todayCount"] == 1)
    #expect(summary["recent"]?.array?.compactMap { $0["id"]?.string } == ["e1", "e2"])
  }
}

@Suite struct MiniAppDocumentTests {
  @Test func theDocumentAllowsNoNetworkFramesOrStorage() {
    let policy = MiniAppDocument.contentSecurityPolicy
    for directive in [
      "default-src 'none'", "connect-src 'none'", "frame-src 'none'", "worker-src 'none'",
      "form-action 'none'", "img-src data:", "sandbox allow-scripts",
    ] {
      #expect(policy.contains(directive), "\(directive)")
    }
    #expect(!policy.contains("allow-same-origin") && !policy.contains("http"))
  }

  @Test func theDocumentWrapsThePageWithTheKitAndItsData() throws {
    let snapshot: MiniAppJSON = ["data": ["title": "</script><script>alert(1)</script>"]]
    let html = MiniAppDocument.html(
      page: "<p id=\"mine\">Hi</p>", tint: .green, snapshot: snapshot,
      locale: Locale(identifier: "zh-Hans"))
    #expect(html.contains("<meta http-equiv=\"Content-Security-Policy\""))
    #expect(!html.contains("content=\"\(MiniAppDocument.contentSecurityPolicy)\""))
    #expect(html.contains("window.atd") && html.contains("<p id=\"mine\">Hi</p>"))
    #expect(html.contains("lang=\"zh-Hans\""))
    // The data cannot close the boot script.
    #expect(!html.contains("</script><script>alert(1)"))
    let boot = try #require(html.range(of: "<script id=\"atd-boot\" type=\"application/json\">"))
    let end = try #require(html[boot.upperBound...].range(of: "</script>"))
    let json = try #require(MiniAppJSON.parse(String(html[boot.upperBound..<end.lowerBound])))
    #expect(json["snapshot"] == snapshot && json["locale"] == "zh-Hans")
  }
}

@Suite struct MiniAppGlanceTests {
  private let now = Fixture.day(21)

  private func glance(_ index: Int, _ changes: [MiniAppOperation] = []) throws -> MiniAppGlance {
    let (app, package) = MiniAppBuiltins.all(now: now)[index]
    var data = try MiniAppData.initial(
      schema: package.manifest.schema, initial: package.manifest.initial)
    try data.apply(changes, schema: package.manifest.schema, context: Fixture.context())
    return MiniAppGlance.make(
      app: app, manifest: package.manifest, data: data, ledger: Ledger(), now: now,
      calendar: Fixture.shanghai)
  }

  @Test func waterCountsTodaysCupsAgainstTheGoal() throws {
    let glance = try glance(1, [.put(field: "cups", value: 5, day: "2026-11-21")])
    guard case .counter(let counter) = glance.body else {
      Issue.record("not a counter")
      return
    }
    #expect(counter.today == "5" && counter.fraction == 0.625)
    #expect(counter.step == MiniAppStep(appID: MiniAppBuiltins.waterID, field: "cups", amount: 1))
    #expect(glance.meta.contains("5/8") && glance.accessory.value == "5/8")
    #expect(glance.accessory.fraction == 0.625 && glance.accessory.inline.contains("5/8"))
  }

  @Test func campCountsWhatIsPacked() throws {
    let glance = try glance(2)
    guard case .checklist(let checklist) = glance.body else {
      Issue.record("not a checklist")
      return
    }
    #expect(checklist.done == 0 && checklist.total == 12 && checklist.rows.count == 3)
    #expect(
      checklist.toggle
        == MiniAppToggle(appID: MiniAppBuiltins.campID, list: "items", field: "packed"))
    #expect(glance.meta.contains("0/12"))
  }

  @Test func everyGlanceHasALabelForVoiceOver() throws {
    for index in 0..<3 {
      let glance = try glance(index)
      #expect(!glance.label.isEmpty && !glance.meta.isEmpty && !glance.accessory.inline.isEmpty)
    }
  }
}
