import AtdModel
import Foundation
import Synchronization
import Testing

@testable import AtdAI

/// Answers with scripted pieces, a failure, or a stream that stays open until the run is
/// cancelled, and keeps every request it was sent.
private final class CardGenerator: TextGenerating {
  enum Reply: Sendable {
    case text([String])
    case failure(ModelFailure)
    case open
  }

  private let reply: Reply
  private let sent = Mutex<[(ModelRequest, ModelChoice)]>([])
  /// The open streams' continuations, kept so the streams stay open.
  private let open = Mutex<[AsyncThrowingStream<String, any Error>.Continuation]>([])

  init(_ reply: Reply) {
    self.reply = reply
  }

  var requests: [ModelRequest] { sent.withLock { $0.map(\.0) } }
  var choices: [ModelChoice] { sent.withLock { $0.map(\.1) } }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    sent.withLock { $0.append((request, choice)) }
    let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
    switch reply {
    case .text(let pieces):
      for piece in pieces { continuation.yield(piece) }
      continuation.finish()
    case .failure(let failure):
      continuation.finish(throwing: failure)
    case .open:
      // Never finished: the stream ends only when the run's task is cancelled, quietly, as a
      // stopped connection does.
      open.withLock { $0.append(continuation) }
    }
    return stream
  }
}

@Suite struct CardRunnerTests {
  static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt

  /// Saturday 21 November 2026, 14:05 in Shanghai.
  private let context = CardContext(
    now: Date(timeIntervalSince1970: 1_795_241_100), timeZone: zone, currency: "CNY")
  private let input = CardInput(text: "周六下午两点，静安图书馆读书会")

  private func command(_ id: String) throws -> Command {
    try #require(BuiltinCommands.all().first { $0.id == id })
  }

  @Test func theWholeAnswerBecomesTheCard() async throws {
    var event = try command(BuiltinCommands.eventID)
    event.model = .connection(id: "c1", model: "m1")
    let generator = CardGenerator(
      .text([#"```json\#n{"title":"读书"#, #"会","start":"2026-11-28T14:00"}"#, "\n```"]))
    let card = try await CardRunner(generator: generator).run(
      event, input: input, context: context)
    guard case .event(let draft) = card else {
      Issue.record("\(card) is not an event")
      return
    }
    #expect(draft.title == "读书会" && draft.alert == .hourBefore)
    #expect(generator.requests == [CardPrompt.request(event, input: input, context: context)])
    #expect(generator.choices == [.connection(id: "c1", model: "m1")])
  }

  @Test func optionValuesForTheRunReachThePromptAndTheCard() async throws {
    let expense = try command(BuiltinCommands.expenseID)
    let book = try #require(expense.option(BuiltinCommands.OptionKey.book))
    let values = [book.key: book.choices[2]]
    let generator = CardGenerator(.text([#"{"amount":"¥88"}"#]))
    let card = try await CardRunner(generator: generator).run(
      expense, input: input, context: context, values: values)
    #expect(card.kind == .expense)
    if case .expense(let draft) = card { #expect(draft.book == book.choices[2]) }
    #expect(
      generator.requests
        == [CardPrompt.request(expense, input: input, context: context, values: values)])
  }

  @Test func failuresComeThrough() async throws {
    let event = try command(BuiltinCommands.eventID)
    let offline = CardRunner(generator: CardGenerator(.failure(.offline)))
    await #expect(throws: ModelFailure.offline) {
      try await offline.run(event, input: input, context: context)
    }
    let nothing = CardRunner(generator: CardGenerator(.text([#"{"found":false}"#])))
    await #expect(throws: CardFailure.nothingFound(.event)) {
      try await nothing.run(event, input: input, context: context)
    }
  }

  /// Half an answer from a cancelled run is never read as a card.
  @Test func aCancelledRunGivesNoCard() async throws {
    let event = try command(BuiltinCommands.eventID)
    let runner = CardRunner(generator: CardGenerator(.open))
    let run = Task { try await runner.run(event, input: input, context: context) }
    run.cancel()
    await #expect(throws: CancellationError.self) { try await run.value }
  }

  private struct Marks: Decodable, Equatable {
    struct Mark: Decodable, Equatable {
      var field: String
      var lines: [Int]
    }

    var marks: [Mark]
  }

  /// The camera's way: its own rule and keys ride along with the card's.
  @Test func extraKeysAreAskedForAndReadBesideTheCard() async throws {
    let expense = try command(BuiltinCommands.expenseID)
    let rule = #"Also add "marks": [{"field": "total", "lines": [n]}]."#
    let generator = CardGenerator(
      .text([#"{"amount":46.5,"marks":[{"field":"total","lines":[7]}]}"#]))
    let (card, marks) = try await CardRunner(generator: generator).run(
      expense, input: input, context: context, asking: rule, reading: Marks.self)
    #expect(card.kind == .expense)
    #expect(marks == Marks(marks: [.init(field: "total", lines: [7])]))
    let plain = CardPrompt.request(expense, input: input, context: context)
    #expect(generator.requests.map(\.system) == [plain.system + "\n" + rule])
    #expect(generator.requests.first?.messages == plain.messages)

    // Missing or malformed marks lose only the marks.
    let unmarked = try await CardRunner(generator: CardGenerator(.text([#"{"amount":5}"#]))).run(
      expense, input: input, context: context, asking: rule, reading: Marks.self)
    #expect(unmarked.card.kind == .expense && unmarked.fields == nil)
  }

  /// A text card answers in plain text, so there are no keys to add.
  @Test func textCardsGoWithoutTheRule() async throws {
    let translate = try command(BuiltinCommands.translateID)
    let generator = CardGenerator(.text([#"{"marks":[]}"#]))
    let result = try await CardRunner(generator: generator).run(
      translate, input: input, context: context, asking: "Add marks.", reading: Marks.self)
    #expect(result.card == .text(TextCard(text: #"{"marks":[]}"#)) && result.fields == nil)
    #expect(
      generator.requests.map(\.system)
        == [CardPrompt.request(translate, input: input, context: context).system])
  }
}
