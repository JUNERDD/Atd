import AtdAI
import AtdModel
import Foundation
import Testing

@testable import AtdAppUI
@testable import AtdMiniApps

/// Answers in order, in small pieces, keeping the requests it got.
final class ScriptedModel: TextGenerating, @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [String]
  private(set) var requests: [ModelRequest] = []

  init(_ answers: [String]) {
    self.answers = answers
  }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    let answer: String? = lock.withLock {
      requests.append(request)
      return answers.isEmpty ? nil : answers.removeFirst()
    }
    return AsyncThrowingStream { continuation in
      guard let answer else {
        continuation.finish(throwing: ModelFailure.server(status: 500))
        return
      }
      var rest = Substring(answer)
      while !rest.isEmpty {
        continuation.yield(String(rest.prefix(9)))
        rest = rest.dropFirst(9)
      }
      continuation.finish()
    }
  }
}

@MainActor @Suite struct MiniAppRunTests {
  @Test func aSectionThatDoesNotFitIsAskedForOnce() async throws {
    let broken = Answers.replacing("WIDGET", with: #"{"template": "streak", "series": "minutes"}"#)
    let model = ScriptedModel([
      broken,
      "[[WIDGET]]\n{\"template\": \"streak\", \"series\": \"pages\", \"unit\": \"pages\"}\n[[END]]",
    ])
    var progress: [Int] = []
    let request = MiniAppPrompt.build("Log my reading", language: "en")
    let draft = try await MiniAppRun.draft(request, runner: model) { answer in
      if progress.last != answer.buildProgress { progress.append(answer.buildProgress) }
    }
    #expect(progress == [0, 1, 2, 3, 4])
    guard case .streak(let streak) = draft.package.manifest.widget else {
      Issue.record("the repaired widget is not a streak")
      return
    }
    #expect(streak.series == "pages")
    #expect(model.requests.count == 2)
    #expect(model.requests[1].messages.last?.text.contains("[[WIDGET]]") == true)
  }

  @Test func aSecondMisfitFails() async throws {
    let broken = Answers.replacing("DATA", with: #"{"fields": "pages"}"#)
    let model = ScriptedModel([broken, "[[DATA]]\nstill not JSON\n[[END]]"])
    await #expect(throws: MiniAppDraftFailure.self) {
      _ = try await MiniAppRun.draft(MiniAppPrompt.build("x", language: "en"), runner: model) {
        _ in
      }
    }
    #expect(model.requests.count == 2)
  }

  @Test func theModelsFailureComesThrough() async throws {
    let model = ScriptedModel([])
    await #expect(throws: ModelFailure.server(status: 500)) {
      _ = try await MiniAppRun.draft(MiniAppPrompt.build("x", language: "en"), runner: model) {
        _ in
      }
    }
  }
}

@MainActor @Suite struct MiniAppsModelTests {
  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "MiniAppsModelTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  private func model() -> MiniAppsModel {
    MiniAppsModel(
      store: MiniAppStore(directory: directory, notificationName: nil),
      ledgerStore: SharedStore(directory: directory, notificationName: nil))
  }

  @Test func theTabShowsEveryAppWithItsLiveLine() {
    let model = model()
    #expect(model.library.apps.map(\.id) == MiniAppBuiltins.ids)
    #expect(MiniAppBuiltins.ids.allSatisfy { model.glances[$0] != nil })
  }

  @Test func aPagesChangeReachesTheCardAtOnce() throws {
    let model = model()
    let water = try #require(model.app(MiniAppBuiltins.waterID))
    let manifest = try #require(model.store.manifest(water))
    let changes = model.changes
    _ = try model.perform(
      .change(.add(field: "cups", amount: 1, day: nil)), app: water, manifest: manifest, book: "")
    #expect(model.changes > changes)
    #expect(model.glances[water.id]?.accessory.value == "1/8")
  }

  @Test func anInsertedRecordComesBackWithItsID() throws {
    let model = model()
    let camp = try #require(model.app(MiniAppBuiltins.campID))
    let manifest = try #require(model.store.manifest(camp))
    let record = try #require(
      try model.perform(
        .change(.insert(list: "items", record: ["label": "Sunscreen"])), app: camp,
        manifest: manifest, book: ""))
    let id = try #require(record["id"]?.string)
    #expect(record["label"] == "Sunscreen" && record["packed"] == false)
    #expect(
      model.store.data(camp.id, schema: manifest.schema).records("items").last?.recordID == id)
  }

  @Test func theLedgerAppLogsIntoTheSharedLedger() throws {
    let model = model()
    let ledger = try #require(model.app(MiniAppBuiltins.ledgerID))
    let manifest = try #require(model.store.manifest(ledger))
    let input = MiniAppExpenseInput(amount: 32, category: .transport, note: "Taxi")
    let logged = try #require(
      try model.perform(.logExpense(input), app: ledger, manifest: manifest, book: "旅行"))
    let id = try #require(logged["id"]?.string)
    let expense = try #require(model.ledgerBook.ledger.expense(id))
    #expect(expense.book == "旅行" && expense.source == .manual && expense.amount == 32)
    _ = try model.perform(.removeExpense(id: id), app: ledger, manifest: manifest, book: "")
    #expect(model.ledgerBook.ledger.expenses.isEmpty)
  }

  @Test func aGeneratedAppIsCreatedAndDeleted() throws {
    let model = model()
    let draft = try MiniAppDraft(answer: MiniAppAnswer(Answers.reading))
    try model.create(draft, data: draft.data)
    #expect(model.library.apps.last?.id == draft.app.id && model.glances[draft.app.id] != nil)
    try model.delete(try #require(model.app(draft.app.id)))
    #expect(model.app(draft.app.id) == nil && model.glances[draft.app.id] == nil)
  }
}
