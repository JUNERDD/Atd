import AtdModel
import Foundation

/// Builds the request for everything the keyboard and the 指令 tab run: a command or one of its
/// versions, a request typed on the ✦ line, ✦ 续写, and refinements of a result (再短点).
///
/// The system prompt is the base rule (only the result, in the original's language unless the
/// instructions say otherwise), then the instructions and the option values (语气：随意). The
/// person's turn is the text the command works on. The prompt is written in the app's language,
/// like the built-in instructions.
public enum CommandPrompt {
  public enum Kind: Sendable, Equatable {
    /// A library command; `values` override its remembered option values (a version).
    case command(Command, values: [String: String] = [:])
    /// A request typed on the ✦ line (按要求).
    case request(String)
    /// ✦ 续写: continue the text before the cursor.
    case continuation
  }

  /// A result that was on show and the change asked of it.
  public struct Refinement: Sendable, Equatable {
    public var result: String
    public var request: String

    public init(result: String, request: String) {
      self.result = result
      self.request = request
    }
  }

  /// - Parameters:
  ///   - input: what the command works on: the selection, the field's text, the text before
  ///     the cursor, or the copied message. When it is empty, the instructions themselves become
  ///     the person's turn.
  ///   - images: photos or screenshots the command works on as well (翻译 a shared screenshot),
  ///     sent with the person's first turn.
  ///   - draft: for a command reading the copied message, what the person already typed in the
  ///     field: what the reply should say. The copied message is what it answers.
  ///   - refinements: earlier results and the change asked of each, oldest first.
  public static func request(
    _ kind: Kind, input: String, images: [ModelImage] = [], draft: String? = nil,
    refinements: [Refinement] = []
  ) -> ModelRequest {
    var rules = [String(localized: "prompt.base", bundle: .module)]
    let draft = draft.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
    if draft != nil { rules.append(String(localized: "prompt.draftRule", bundle: .module)) }
    let (instructions, options) = instructionLines(kind)

    let firstTurn: String
    var system = rules.joined(separator: "\n")
    if input.isEmpty {
      firstTurn = ([instructions] + options).joined(separator: "\n")
    } else {
      let label = String(localized: "prompt.instructions \(instructions)", bundle: .module)
      system += "\n\n" + ([label] + options).joined(separator: "\n")
      firstTurn = draft.map { framed(message: input, draft: $0) } ?? input
    }

    var messages = [ModelMessage(.user, firstTurn, images: images)]
    for refinement in refinements {
      messages.append(ModelMessage(.assistant, refinement.result))
      messages.append(ModelMessage(.user, refinement.request))
    }
    return ModelRequest(system: system, messages: messages)
  }

  /// The instructions, and one line per option.
  private static func instructionLines(_ kind: Kind) -> (String, [String]) {
    switch kind {
    case .command(let command, let values):
      let options = command.options.map { option in
        let value = values[option.key] ?? option.value
        return String(localized: "prompt.option \(option.label) \(value)", bundle: .module)
      }
      return (command.instructions, options)
    case .request(let request):
      return (request, [])
    case .continuation:
      return (String(localized: "prompt.continue", bundle: .module), [])
    }
  }

  private static func framed(message: String, draft: String) -> String {
    [
      String(localized: "prompt.theirMessage", bundle: .module), message, "",
      String(localized: "prompt.myDraft", bundle: .module), draft,
    ].joined(separator: "\n")
  }
}

/// Builds the requests 问 Atd sends: a question, with photos, after any earlier exchanges.
public enum AskPrompt {
  /// An earlier question and its answer.
  public struct Exchange: Sendable, Equatable {
    public var question: String
    public var images: [ModelImage]
    public var answer: String

    public init(question: String, images: [ModelImage] = [], answer: String) {
      self.question = question
      self.images = images
      self.answer = answer
    }
  }

  public static func request(
    _ question: String, images: [ModelImage] = [], after earlier: [Exchange] = []
  ) -> ModelRequest {
    var messages: [ModelMessage] = []
    for exchange in earlier {
      messages.append(ModelMessage(.user, exchange.question, images: exchange.images))
      messages.append(ModelMessage(.assistant, exchange.answer))
    }
    messages.append(ModelMessage(.user, question, images: images))
    return ModelRequest(
      system: String(localized: "prompt.ask", bundle: .module), messages: messages)
  }
}

extension String {
  fileprivate var nilIfEmpty: String? { isEmpty ? nil : self }
}
