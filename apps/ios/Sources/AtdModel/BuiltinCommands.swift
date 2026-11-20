import Foundation

/// The commands a new library starts with: four that rewrite text in the keyboard and elsewhere,
/// and four that turn what was shared, photographed or planned for today into a card.
///
/// Their names, instructions, option labels and choices come from this module's String Catalog
/// in the language the library is first created in; after that they are the person's data and
/// stay as edited.
public enum BuiltinCommands {
  public static let polishID = "polish"
  public static let replyID = "reply"
  public static let translateID = "translate"
  public static let shortenID = "shorten"
  public static let eventID = "event"
  public static let expenseID = "expense"
  public static let briefingID = "briefing"
  public static let whiteboardID = "whiteboard"

  /// Every built-in command, in the library's order.
  public static func all() -> [Command] {
    [polish(), reply(), translate(), shorten()] + cards()
  }

  /// The ids of the built-in commands, which the person can take out of places but not delete.
  public static let ids: Set<String> = [
    polishID, replyID, translateID, shortenID, eventID, expenseID, briefingID, whiteboardID,
  ]

  /// The keys of the built-in commands' options, for `Command.option(_:)` and the values a run
  /// overrides. Libraries store them, so they never change. The card commands' keys are also
  /// their typed choices' `optionKey` (`EventAlert`, `BriefingDetail`, `NotesFormat`).
  public enum OptionKey {
    /// 语气, of 润色 and 帮我回复.
    public static let tone = "tone"
    /// 长度, of 润色.
    public static let length = "length"
    /// 态度, of 帮我回复.
    public static let stance = "stance"
    /// 译成, of 翻译: the language to translate into.
    public static let language = "to"
    /// 目标, of 缩短.
    public static let target = "target"
    /// 提醒, of 提取日程.
    public static let alert = "alert"
    /// 记到, of 记一笔: the book the expense goes in, by name.
    public static let book = "book"
    /// 详细程度, of 今日简报.
    public static let detail = "detail"
    /// 整理成, of 整理白板.
    public static let format = "format"
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
      key: OptionKey.length, label: String(localized: "option.length", bundle: .module),
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
      output: CommandOutput(action: .replace),
      placement: CommandPlacement(keyboard: true, share: true, siri: true),
      adjustments: adjustments())
  }

  static func reply() -> Command {
    let stance = CommandOption(
      key: OptionKey.stance, label: String(localized: "option.stance", bundle: .module),
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
      key: OptionKey.language, label: String(localized: "option.to", bundle: .module),
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
      output: CommandOutput(action: .replace),
      placement: CommandPlacement(keyboard: true, share: true, camera: true, siri: true),
      adjustments: adjustments())
  }

  static func shorten() -> Command {
    let target = CommandOption(
      key: OptionKey.target, label: String(localized: "option.target", bundle: .module),
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
      output: CommandOutput(action: .replace),
      placement: CommandPlacement(keyboard: true, share: true), adjustments: adjustments())
  }

  private static func toneOption() -> CommandOption {
    CommandOption(
      key: OptionKey.tone, label: String(localized: "option.tone", bundle: .module),
      choices: [
        String(localized: "tone.formal", bundle: .module),
        String(localized: "tone.casual", bundle: .module),
        String(localized: "tone.warm", bundle: .module),
      ],
      value: String(localized: "tone.casual", bundle: .module))
  }
}
