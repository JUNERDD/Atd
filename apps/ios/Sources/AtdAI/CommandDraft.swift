import AtdModel
import Foundation

/// Drafts a command from one sentence (新建指令): the request asks the model for the command as a
/// JSON object, and `command(from:id:)` reads the answer into a command placed in the keyboard,
/// for the person to review before it is saved.
public enum CommandDraft {
  /// At most this many options; the keyboard's options panel has room for no more.
  public static let optionLimit = 3

  public static func request(_ description: String) -> ModelRequest {
    ModelRequest(
      system: String(localized: "prompt.draft", bundle: .module),
      messages: [ModelMessage(.user, description)])
  }

  /// The command the answer describes, or nil when it does not describe one. Values this build
  /// cannot run fall back to ones it can: a field's text in, the result replacing it.
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
    let input: CommandInput =
      switch draft.input {
      case "copied": .copied
      case "none": .none
      default: .text
      }
    // Without input there is nothing to replace.
    let action: CommandOutput.Action =
      draft.output == "insert" || input == .none ? .insert : .replace
    return Command(
      id: id, name: name, symbol: draft.symbol ?? "sparkles",
      tint: draft.tint.flatMap(CommandTint.init(rawValue:)) ?? .purple,
      instructions: instructions, options: options, versionOption: options.first?.key,
      input: input, output: CommandOutput(action: action, review: draft.review ?? true),
      placement: CommandPlacement(keyboard: true), adjustments: BuiltinCommands.adjustments())
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
