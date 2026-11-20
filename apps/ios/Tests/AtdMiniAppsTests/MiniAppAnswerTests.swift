import AtdAI
import AtdMiniApps
import Foundation
import Testing

enum Answers {
  static let reading = """
    Sure, here it is.
    [[ABOUT]]
    name: Reading
    symbol: book
    tint: brown
    understand: Log the pages read each day and keep a streak
    data: Pages read per day
    page: The streak, the last week and today's pages
    widget: Days in a row and the last week
    ideas: Add a monthly calendar | Make the daily goal 30 pages
    [[DATA]]
    ```json
    {"fields": [{"name": "pages", "kind": "daily", "min": 0, "max": 2000, "step": 5}]}
    ```
    [[PAGE]]
    <section class="card"><span class="big" id="streak"></span></section>
    <script>atd.onData((data, atd) => { streak.textContent = atd.stats.pages.streak; });</script>
    [[WIDGET]]
    {"template": "streak", "series": "pages", "goal": null, "unit": "pages", "kicker": "Reading streak"}
    [[END]]
    Anything after the end is not part of the app.
    """

  /// The answer with one section's text replaced.
  static func replacing(_ section: String, with text: String, in answer: String = reading)
    -> String
  {
    let start = answer.range(of: "[[\(section)]]")!
    let end = answer[start.upperBound...].range(of: "\n[[")!
    return answer.replacingCharacters(in: start.upperBound..<end.lowerBound, with: "\n" + text)
  }
}

/// The section a failed draft asks for again; nil for an answer that cannot be repaired.
func section(_ failure: MiniAppDraftFailure?) -> MiniAppAnswer.Section? {
  if case .section(let section, _)? = failure { section } else { nil }
}

@Suite struct MiniAppAnswerTests {
  @Test func anAnswerReadsTheSameHoweverItIsSplit() {
    let whole = MiniAppAnswer(Answers.reading)
    var generator = SystemRandomNumberGenerator()
    for _ in 0..<20 {
      var streamed = MiniAppAnswer()
      var rest = Substring(Answers.reading)
      while !rest.isEmpty {
        let size = Int.random(in: 1...12, using: &generator)
        streamed.append(String(rest.prefix(size)))
        rest = rest.dropFirst(size)
      }
      streamed.finish()
      #expect(streamed == whole)
    }
  }

  @Test func sectionsDropTheirFencesAndTheProseAroundThem() throws {
    let answer = MiniAppAnswer(Answers.reading)
    #expect(answer.isComplete)
    #expect(answer.about["name"] == "Reading" && answer.about["tint"] == "brown")
    #expect(answer.ideas == ["Add a monthly calendar", "Make the daily goal 30 pages"])
    #expect(answer.content(.data)?.hasPrefix("{\"fields\"") == true)
    #expect(try #require(answer.json(.widget))["template"] == "streak")
    #expect(answer.content(.page)?.contains("Anything after") == false)
  }

  @Test func theBuildStepsFollowTheSectionsAsTheyArrive() {
    var answer = MiniAppAnswer()
    var seen: [Int] = []
    for line in Answers.reading.split(separator: "\n", omittingEmptySubsequences: false) {
      answer.append(line + "\n")
      if seen.last != answer.buildProgress { seen.append(answer.buildProgress) }
    }
    #expect(seen == [0, 1, 2, 3, 4])
  }

  @Test func aRefinementsStepsFollowWhatItChanges() {
    var answer = MiniAppAnswer()
    answer.append("[[ABOUT]]\nsummary: Bigger numbers\n")
    #expect(answer.refineProgress == 0)
    answer.append("[[PAGE]]\n<p>new</p>\n")
    #expect(answer.refineProgress == 1)
    answer.append("[[END]]\n")
    #expect(answer.refineProgress == 3)
  }

  @Test func aboutLinesTakeEitherColon() {
    let answer = MiniAppAnswer("[[ABOUT]]\n名字：读书\nsymbol: book\n[[END]]")
    #expect(answer.about == ["名字": "读书", "symbol": "book"])
  }
}

@Suite struct MiniAppDraftTests {
  private let now = Fixture.day(21)

  @Test func aCompleteAnswerMakesAnApp() throws {
    let draft = try MiniAppDraft(answer: MiniAppAnswer(Answers.reading), now: now) { _ in true }
    #expect(draft.app.name == "Reading" && draft.app.symbol == "book" && draft.app.tint == .brown)
    #expect(!draft.app.builtin && MiniApps.isValidID(draft.app.id))
    #expect(draft.app.ideas.count == 2 && draft.app.createdAt == now)
    #expect(
      draft.package.manifest.schema.fields == [
        MiniAppField("pages", .daily, min: 0, max: 2_000, step: 5)
      ])
    #expect(draft.package.page.hasPrefix("<section class=\"card\">"))
    #expect(draft.data.series("pages").isEmpty)
    #expect(draft.details.first == "Log the pages read each day and keep a streak")
    guard case .streak(let streak) = draft.package.manifest.widget else {
      Issue.record("the widget is not a streak")
      return
    }
    #expect(streak.series == "pages" && streak.goal == nil)
  }

  @Test func anUnknownSymbolBecomesAGenericOne() throws {
    let draft = try MiniAppDraft(answer: MiniAppAnswer(Answers.reading)) { _ in false }
    #expect(draft.app.symbol == "square.grid.2x2")
  }

  @Test func aDataSectionThatDoesNotFitCanBeAskedForAgain() throws {
    let broken = MiniAppAnswer(
      Answers.replacing("DATA", with: #"{"fields": [{"name": "Pages", "kind": "daily"}]}"#))
    let failure = #expect(throws: MiniAppDraftFailure.self) {
      try MiniAppDraft(answer: broken) { _ in true }
    }
    #expect(section(failure) == .data)
    let repair = MiniAppAnswer(
      "[[DATA]]\n{\"fields\": [{\"name\": \"pages\", \"kind\": \"daily\"}]}\n[[END]]")
    let draft = try MiniAppDraft(answer: broken.replacing(.data, from: repair)) { _ in true }
    #expect(draft.package.manifest.schema.fields.map(\.name) == ["pages"])
  }

  @Test(arguments: [
    #"{"template": "streak", "series": "minutes"}"#,
    #"{"template": "counter", "series": "pages", "goal": "target"}"#,
    #"{"template": "gauge"}"#, "not json",
  ])
  func aWidgetThatDoesNotFitTheDataCanBeAskedForAgain(_ widget: String) {
    let answer = MiniAppAnswer(Answers.replacing("WIDGET", with: widget))
    let failure = #expect(throws: MiniAppDraftFailure.self) {
      try MiniAppDraft(answer: answer) { _ in true }
    }
    #expect(section(failure) == .widget)
  }

  @Test func anAnswerWithoutAPageIsUnreadable() {
    let answer = MiniAppAnswer(Answers.reading.replacingOccurrences(of: "[[PAGE]]", with: ""))
    let failure = #expect(throws: MiniAppDraftFailure.self) {
      try MiniAppDraft(answer: answer) { _ in true }
    }
    #expect(failure != nil && section(failure) == nil)
  }

  @Test func aWholeDocumentGivesItsBody() throws {
    let answer = MiniAppAnswer(
      Answers.replacing(
        "PAGE", with: "<!doctype html><html><body class=\"x\">\n<p>Hi</p>\n</body></html>"))
    #expect(try MiniAppDraft(answer: answer) { _ in true }.package.page == "<p>Hi</p>")
  }
}

@Suite struct MiniAppRefinementTests {
  private var current: MiniAppPackage {
    get throws { try MiniAppDraft(answer: MiniAppAnswer(Answers.reading)) { _ in true }.package }
  }

  @Test func aRefinementKeepsWhatItLeavesOut() throws {
    let current = try current
    let answer = MiniAppAnswer(
      "[[ABOUT]]\nsummary: Added a calendar\nideas: Show the month\n[[PAGE]]\n<p>calendar</p>\n[[END]]"
    )
    let refinement = try MiniAppRefinement(answer: answer, current: current)
    #expect(refinement.package.manifest == current.manifest)
    #expect(refinement.package.page == "<p>calendar</p>")
    #expect(refinement.summary == "Added a calendar" && refinement.ideas == ["Show the month"])
    #expect(refinement.operations.isEmpty)
  }

  @Test func aRefinementMayAddFieldsAndChangeRecords() throws {
    let answer = MiniAppAnswer(
      """
      [[ABOUT]]
      summary: A goal of 30 pages
      [[DATA]]
      {"fields": [{"name": "pages", "kind": "daily", "min": 0, "max": 2000, "step": 5},
       {"name": "goal", "kind": "number", "default": 30}],
       "ops": [{"op": "set", "field": "goal", "value": 30}]}
      [[WIDGET]]
      {"template": "streak", "series": "pages", "goal": "goal", "unit": "pages", "kicker": "Reading"}
      [[END]]
      """)
    let refinement = try MiniAppRefinement(answer: answer, current: try current)
    #expect(refinement.package.manifest.schema.fields.map(\.name) == ["pages", "goal"])
    #expect(refinement.operations == [.set(field: "goal", value: 30)])
  }

  @Test(arguments: [
    #"{"fields": [{"name": "minutes", "kind": "daily"}]}"#,
    #"{"fields": [{"name": "pages", "kind": "number"}]}"#,
    #"{"ops": [{"op": "add", "field": "pages", "amount": 5}]}"#,
    #"{"ops": [{"op": "put", "field": "pages", "value": 5}]}"#,
  ])
  func aRefinementCannotDropFieldsOrRewriteHistory(_ data: String) throws {
    let answer = MiniAppAnswer("[[ABOUT]]\nsummary: x\n[[DATA]]\n\(data)\n[[END]]")
    let current = try current
    let failure = #expect(throws: MiniAppDraftFailure.self) {
      try MiniAppRefinement(answer: answer, current: current)
    }
    #expect(section(failure) == .data)
  }

  @Test func aRefinementThatChangesNothingIsUnreadable() throws {
    let answer = MiniAppAnswer("[[ABOUT]]\nsummary: Nothing\n[[END]]")
    let current = try current
    #expect(throws: MiniAppDraftFailure.self) {
      try MiniAppRefinement(answer: answer, current: current)
    }
  }
}

@Suite struct MiniAppPromptTests {
  @Test func aBuildSendsOnlyTheSentence() {
    let request = MiniAppPrompt.build("Count my push-ups", language: "zh-Hans")
    #expect(request.messages == [ModelMessage(.user, "Count my push-ups")])
    #expect(request.system.contains("[[ABOUT]]") && request.system.contains("Chinese"))
  }

  @Test func aRefinementSendsThePageAndValuesButNotTheDailyHistory() throws {
    let draft = try MiniAppDraft(answer: MiniAppAnswer(Answers.reading)) { _ in true }
    var data = draft.data
    try data.apply(
      .put(field: "pages", value: 35, day: "2026-11-20"),
      schema: draft.package.manifest.schema, context: Fixture.context())
    let request = MiniAppPrompt.refine(
      "Make the numbers bigger", app: draft.app, package: draft.package, data: data,
      language: "en")
    let message = try #require(request.messages.first?.text)
    #expect(message.contains("Make the numbers bigger") && message.contains(draft.package.page))
    #expect(!message.contains("2026-11-20"))
  }

  @Test func aRepairAsksForOneSection() {
    let original = MiniAppPrompt.build("Count my push-ups", language: "en")
    let repair = MiniAppPrompt.repair(
      original, answer: "[[ABOUT]]…", section: .widget, reason: "no such field")
    #expect(repair.messages.count == 3 && repair.messages[1].role == .assistant)
    #expect(repair.messages[2].text.contains("[[WIDGET]]"))
  }
}
