import AtdModel
import Foundation

/// Runs a command whose result a surface shows as a card: the share sheet, the camera, Siri and
/// the briefing's Live Activity. It sends one `CardPrompt` request to the model the command
/// names (or the default one), waits for the whole answer and reads it with `CardParser`.
///
/// A card command gives its own kind of card; any other command (润色 in the share sheet, or a
/// command of the person's own in the camera) gives a text card, whatever its output action.
/// Only `input` is sent, and only when `run` is called.
public struct CardRunner: Sendable {
  private let generator: any TextGenerating

  public init(generator: any TextGenerating) {
    self.generator = generator
  }

  /// - Parameter values: option values chosen for this run that override the remembered ones.
  /// - Throws: a `ModelFailure` (the request failed, or `.unreadable` for an answer that is not
  ///   the card asked for), `CardFailure.nothingFound` when the content holds nothing of the
  ///   kind, or `CancellationError` when the task is cancelled.
  public func run(
    _ command: Command, input: CardInput, context: CardContext = CardContext(),
    values: [String: String] = [:]
  ) async throws -> CardResult {
    let request = CardPrompt.request(command, input: input, context: context, values: values)
    let answer = try await answer(to: request, model: command.model)
    return try CardParser.card(from: answer, for: command, context: context, values: values)
  }

  /// Runs `command` as `run(_:input:context:values:)` does and also reads keys of the caller's
  /// own from the card's JSON object: `rule`, appended to the system prompt, asks for them, and
  /// `fields` decodes them from the object the card is read from. The camera asks this way for
  /// the numbered text lines each part of the card came from.
  ///
  /// A text card answers in plain text, so its request goes without `rule` and the fields are
  /// nil. Fields that are missing or do not decode are nil too, and leave the card as it is.
  /// - Throws: what `run(_:input:context:values:)` throws.
  public func run<Fields: Decodable>(
    _ command: Command, input: CardInput, context: CardContext = CardContext(),
    values: [String: String] = [:], asking rule: String, reading fields: Fields.Type
  ) async throws -> (card: CardResult, fields: Fields?) {
    var request = CardPrompt.request(command, input: input, context: context, values: values)
    let answersInJSON = command.output.cardKind != .text
    if answersInJSON { request.system += "\n" + rule }
    let answer = try await answer(to: request, model: command.model)
    let card = try CardParser.card(from: answer, for: command, context: context, values: values)
    return (card, answersInJSON ? CardParser.fields(fields, in: answer) : nil)
  }

  private func answer(to request: ModelRequest, model: ModelChoice) async throws -> String {
    var answer = ""
    for try await delta in generator.stream(request, choice: model) {
      answer += delta
    }
    // A cancelled stream may end quietly; half an answer is no card.
    try Task.checkCancellation()
    return answer
  }
}
