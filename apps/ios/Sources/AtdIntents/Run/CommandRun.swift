import AtdAI
import AtdActions
import AtdModel
import Foundation

/// What a command still needs before it runs from Siri, Shortcuts or a control.
public enum CommandInputNeed: Equatable, Sendable {
  /// Everything it reads is at hand.
  case ready
  /// It reads text and got none, so Siri or Shortcuts asks for it.
  case text
  /// It reads a photo and got none.
  case image
  /// It reads the clipboard, which only the app in the foreground may read.
  case clipboard

  /// - Parameter text: the text the entry point was given; blank counts as none.
  public init(_ input: CommandInput, text: String?, hasImage: Bool) {
    let hasText = text?.contains { !$0.isWhitespace } == true
    switch input {
    case .text, .shared: self = hasText ? .ready : .text
    case .copied: self = hasText ? .ready : .clipboard
    case .image: self = hasImage ? .ready : .image
    case .none: self = .ready
    }
  }
}

/// Runs a command for an entry point and reads the answer into a card; a command that only
/// writes text comes back as a text card. Only the built-in 今日简报 reads the agenda: a person's
/// own command that reads nothing runs on its instructions alone (A27).
public struct CommandRun: Sendable {
  public let context: EntryContext

  public init(_ context: EntryContext) {
    self.context = context
  }

  /// - Parameter asking: whether 今日简报 may ask for access to the calendar and reminders, which
  ///   only a run in the foreground can.
  /// - Throws: a `ModelFailure` or `CardFailure`, `ActionError.denied(.calendar)` when 今日简报
  ///   may read neither the calendar nor the reminders, or `CancellationError`.
  public func card(
    _ command: Command, text: String = "", images: [ModelImage] = [], asking: Bool
  ) async throws -> CardResult {
    var input = CardInput(text: text, images: images)
    if command.id == BuiltinCommands.briefingID {
      input.agenda = try await context.reader.agenda(asking: asking)
    }
    return try await CardRunner(generator: context.generator).run(command, input: input)
  }

  /// Whether 今日简报 should ask for access before it runs: a run that does not ask leaves out a
  /// list Atd was never asked about, and a calendar it may only add to.
  public static func briefingNeedsAsking(_ reader: TodayReader) -> Bool {
    ProtectedData.allCases.contains {
      [.notDetermined, .writeOnly].contains(reader.access(to: $0))
    }
  }
}
