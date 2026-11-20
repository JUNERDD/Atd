import Foundation

/// The commands a new library starts with: the four keyboard commands of the first release.
///
/// Their names, instructions, option labels and choices come from this module's String Catalog
/// in the language the library is first created in; after that they are the person's data and
/// stay as edited.
public enum BuiltinCommands {
  public static let polishID = "polish"
  public static let replyID = "reply"
  public static let translateID = "translate"
  public static let shortenID = "shorten"

  public static func all() -> [Command] {
    [polish(), reply(), translate(), shorten()]
  }

  /// The quick refinements every built-in command offers while a result is on show.
  public static func adjustments() -> [String] {
    [
      String(localized: "adjust.shorter", bundle: .module),
      String(localized: "adjust.formal", bundle: .module),
      String(localized: "adjust.emoji", bundle: .module),
    ]
  }

  static func polish() -> Command {
    let tone = toneOption()
    let length = CommandOption(
      key: "length", label: String(localized: "option.length", bundle: .module),
      choices: [
        String(localized: "length.shorter", bundle: .module),
        String(localized: "length.same", bundle: .module),
        String(localized: "length.longer", bundle: .module),
      ],
      value: String(localized: "length.same", bundle: .module))
    return Command(
      id: polishID, name: String(localized: "polish.name", bundle: .module), symbol: "sparkles",
      tint: .indigo, instructions: String(localized: "polish.instructions", bundle: .module),
      options: [tone, length], versionOption: tone.key, input: .text,
      output: CommandOutput(action: .replace), placement: CommandPlacement(keyboard: true),
      adjustments: adjustments())
  }

  static func reply() -> Command {
    let stance = CommandOption(
      key: "stance", label: String(localized: "option.stance", bundle: .module),
      choices: [
        String(localized: "stance.accept", bundle: .module),
        String(localized: "stance.decline", bundle: .module),
        String(localized: "stance.maybe", bundle: .module),
      ],
      value: String(localized: "stance.accept", bundle: .module))
    let tone = toneOption()
    return Command(
      id: replyID, name: String(localized: "reply.name", bundle: .module),
      symbol: "arrowshape.turn.up.left", tint: .blue,
      instructions: String(localized: "reply.instructions", bundle: .module),
      options: [stance, tone], versionOption: stance.key, draftVersionOption: tone.key,
      input: .copied, output: CommandOutput(action: .insert),
      placement: CommandPlacement(keyboard: true), adjustments: adjustments())
  }

  static func translate() -> Command {
    let target = CommandOption(
      key: "to", label: String(localized: "option.to", bundle: .module),
      choices: [
        String(localized: "to.english", bundle: .module),
        String(localized: "to.chinese", bundle: .module),
        String(localized: "to.japanese", bundle: .module),
      ],
      value: String(localized: "to.english", bundle: .module))
    return Command(
      id: translateID, name: String(localized: "translate.name", bundle: .module),
      symbol: "translate", tint: .teal,
      instructions: String(localized: "translate.instructions", bundle: .module),
      options: [target], versionOption: target.key, input: .text,
      output: CommandOutput(action: .replace), placement: CommandPlacement(keyboard: true),
      adjustments: adjustments())
  }

  static func shorten() -> Command {
    let target = CommandOption(
      key: "target", label: String(localized: "option.target", bundle: .module),
      choices: [
        String(localized: "target.sentence", bundle: .module),
        String(localized: "target.half", bundle: .module),
        String(localized: "target.points", bundle: .module),
      ],
      value: String(localized: "target.sentence", bundle: .module))
    return Command(
      id: shortenID, name: String(localized: "shorten.name", bundle: .module), symbol: "scissors",
      tint: .pink, instructions: String(localized: "shorten.instructions", bundle: .module),
      options: [target], versionOption: target.key, input: .text,
      output: CommandOutput(action: .replace), placement: CommandPlacement(keyboard: true),
      adjustments: adjustments())
  }

  private static func toneOption() -> CommandOption {
    CommandOption(
      key: "tone", label: String(localized: "option.tone", bundle: .module),
      choices: [
        String(localized: "tone.formal", bundle: .module),
        String(localized: "tone.casual", bundle: .module),
        String(localized: "tone.warm", bundle: .module),
      ],
      value: String(localized: "tone.casual", bundle: .module))
  }
}
