import AtdModel
import Foundation

/// Drafts a command from one sentence (新建指令): the request asks the model for the command as a
/// JSON object, and `command(from:id:)` reads the answer into a command placed where it can run,
/// for the person to review before it is saved.
public enum CommandDraft {
  /// At most this many options; the keyboard's options panel has room for no more.
  public static let optionLimit = 3

  public static func request(_ description: String) -> ModelRequest {
    ModelRequest(
      system: String(localized: "prompt.draft", table: "CommandDraft", bundle: .module),
      messages: [ModelMessage(.user, description)])
  }

  /// The command the answer describes, or nil when it does not describe one. What it reads and
  /// gives is checked here (see `shape(of:)`), and it is placed in the entry points that run it.
  public static func command(from answer: String, id: String = UUID().uuidString) -> Command? {
    guard let start = answer.firstIndex(of: "{"), let end = answer.lastIndex(of: "}"),
      start < end,
      let draft = try? JSONDecoder().decode(Draft.self, from: Data(answer[start...end].utf8))
    else { return nil }
    let name = draft.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let instructions = draft.instructions?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !name.isEmpty, !instructions.isEmpty else { return nil }
    let options = (draft.options ?? []).compactMap(\.option).prefix(optionLimit).enumerated().map {
      index, option in
      CommandOption(
        key: "option\(index + 1)", label: option.label, choices: option.choices,
        value: option.value)
    }
    let (input, output) = shape(of: draft)
    return Command(
      id: id, name: name, symbol: draft.symbol ?? "sparkles",
      tint: draft.tint.flatMap(CommandTint.init(rawValue:)) ?? .purple,
      instructions: instructions, options: options, versionOption: options.first?.key,
      input: input, output: output, placement: placement(input: input, output: output),
      adjustments: BuiltinCommands.adjustments())
  }

  /// The kinds of card a drafted command may show. An expense is 记一笔's and a briefing is
  /// 今日简报's: only those built-ins get the ledger and the agenda.
  private static let draftableCards: Set<CardKind> = [.text, .notes, .event]

  /// What the drafted command reads and gives. It reads the field, a copy, what is shared or
  /// nothing, never a photo; anything else reads the field. A card of no kind a draft may show
  /// makes a plain text command instead (the field's text in, the result replacing it), so
  /// nothing is saved that no entry point runs.
  private static func shape(of draft: Draft) -> (CommandInput, CommandOutput) {
    let review = draft.review ?? true
    let input: CommandInput =
      switch draft.input {
      case "copied": .copied
      case "shared": .shared
      case "none": .none
      default: .text
      }
    if draft.output == "card" {
      guard let kind = draft.card.flatMap(CardKind.init(rawValue:)), draftableCards.contains(kind)
      else { return (.text, CommandOutput(action: .replace, review: review)) }
      return (input, CommandOutput(action: .card, review: review, card: kind))
    }
    // What is shared has no field to write into: its result shows on a card.
    if input == .shared {
      return (input, CommandOutput(action: .card, review: review, card: .text))
    }
    // Without input there is nothing to replace.
    let insert = draft.output == "insert" || input == .none
    return (input, CommandOutput(action: insert ? .insert : .replace, review: review))
  }

  /// Where a drafted command goes: the keyboard when it writes into the field; the share sheet
  /// and Siri when it reads what is shared or shows a card; controls and Siri when it needs no
  /// input. Each of them runs it (`Command.runs(on:)`).
  private static func placement(input: CommandInput, output: CommandOutput) -> CommandPlacement {
    if input == .none { return CommandPlacement(controls: true, siri: true) }
    if input == .shared || output.action == .card {
      return CommandPlacement(share: true, siri: true)
    }
    return CommandPlacement(keyboard: true)
  }

  /// A blank command for the person to fill in, placed in the keyboard.
  public static func blank(id: String = UUID().uuidString, tint: CommandTint) -> Command {
    Command(
      id: id, name: "", symbol: "sparkles", tint: tint, instructions: "", input: .text,
      output: CommandOutput(action: .replace), placement: CommandPlacement(keyboard: true),
      adjustments: BuiltinCommands.adjustments())
  }

  /// The answer's shape; every field may be missing or unusable.
  private struct Draft: Decodable {
    var name: String?
    var symbol: String?
    var tint: String?
    var instructions: String?
    var input: String?
    var output: String?
    /// The kind of card, with output `card`.
    var card: String?
    var review: Bool?
    var options: [Option]?
  }

  private struct Option: Decodable {
    var label: String?
    var choices: [String]?
    var value: String?

    /// The option with its label and at least two distinct choices, the default among them.
    var option: (label: String, choices: [String], value: String)? {
      let label = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      var choices: [String] = []
      for choice in self.choices ?? [] {
        let choice = choice.trimmingCharacters(in: .whitespacesAndNewlines)
        if !choice.isEmpty, !choices.contains(choice) { choices.append(choice) }
      }
      guard !label.isEmpty, choices.count >= 2, let first = choices.first else { return nil }
      let value = value.flatMap { choices.contains($0) ? $0 : nil } ?? first
      return (label, choices, value)
    }
  }
}
