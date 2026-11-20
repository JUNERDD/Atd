import Foundation

/// The built-in commands whose result is a card. None of them runs in the keyboard: they read
/// what was shared, a photo, or today's agenda.
///
/// Each card command's one option is read as a typed value (`CardChoice`) or, for 记到, as the
/// book's name, so the choices are listed here in the order of that type's cases.
extension BuiltinCommands {
  static func cards() -> [Command] {
    [event(), expense(), briefing(), whiteboard()]
  }

  static func event() -> Command {
    let alert = CommandOption(
      key: OptionKey.alert, label: String(localized: "option.alert", bundle: .module),
      choices: [
        String(localized: "alert.off", bundle: .module),
        String(localized: "alert.hour", bundle: .module),
        String(localized: "alert.day", bundle: .module),
      ],
      value: String(localized: "alert.hour", bundle: .module))
    return Command(
      id: eventID, name: String(localized: "event.name", bundle: .module),
      symbol: "calendar.badge.plus", tint: .red,
      instructions: String(localized: "event.instructions", bundle: .module), options: [alert],
      input: .shared, output: CommandOutput(action: .card, review: true, card: .event),
      placement: CommandPlacement(share: true, camera: true, siri: true))
  }

  static func expense() -> Command {
    let book = CommandOption(
      key: OptionKey.book, label: String(localized: "option.book", bundle: .module),
      choices: [
        String(localized: "book.daily", bundle: .module),
        String(localized: "book.travel", bundle: .module),
        String(localized: "book.reimbursable", bundle: .module),
      ],
      value: String(localized: "book.daily", bundle: .module))
    return Command(
      id: expenseID, name: String(localized: "expense.name", bundle: .module), symbol: "receipt",
      tint: .orange, instructions: String(localized: "expense.instructions", bundle: .module),
      options: [book], input: .image,
      output: CommandOutput(action: .card, review: false, card: .expense),
      placement: CommandPlacement(share: true, camera: true, controls: true, siri: true))
  }

  static func briefing() -> Command {
    let detail = CommandOption(
      key: OptionKey.detail, label: String(localized: "option.detail", bundle: .module),
      choices: [
        String(localized: "detail.brief", bundle: .module),
        String(localized: "detail.full", bundle: .module),
      ],
      value: String(localized: "detail.brief", bundle: .module))
    return Command(
      id: briefingID, name: String(localized: "briefing.name", bundle: .module),
      symbol: "sunrise", tint: .yellow,
      instructions: String(localized: "briefing.instructions", bundle: .module),
      options: [detail], input: .none,
      output: CommandOutput(action: .card, review: false, card: .briefing),
      placement: CommandPlacement(controls: true, siri: true))
  }

  static func whiteboard() -> Command {
    let format = CommandOption(
      key: OptionKey.format, label: String(localized: "option.format", bundle: .module),
      choices: [
        String(localized: "format.notes", bundle: .module),
        String(localized: "format.todos", bundle: .module),
        String(localized: "format.both", bundle: .module),
      ],
      value: String(localized: "format.both", bundle: .module))
    return Command(
      id: whiteboardID, name: String(localized: "whiteboard.name", bundle: .module),
      symbol: "rectangle.and.pencil.and.ellipsis", tint: .green,
      instructions: String(localized: "whiteboard.instructions", bundle: .module),
      options: [format], input: .image,
      output: CommandOutput(action: .card, review: false, card: .notes),
      placement: CommandPlacement(share: true, camera: true))
  }
}
