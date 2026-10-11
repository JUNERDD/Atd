import Foundation

/// What the command island shows for the page (`commandProgress.show`) and for `text.write`: the
/// progress of a command that runs without the panel and writes its answer back into another
/// app (a light launch). One island shows at a time, keyed by the write target its launch
/// captured: a show for another target replaces it, and a hide for another target leaves it.
///
/// The phase decides what the island offers: `working` cancels (its button, or Escape, which
/// only then belongs to the island) and, with a values summary, changes the options; `choose` is
/// the options card; `writing` and `done` are the shell's own while it writes the answer, `done`
/// going by itself after ``doneDuration``; a `notice` opens the run in the panel and goes by
/// itself after ``noticeDuration``; an `answer` card, shown where the answer could not be
/// written, opens the run in the panel or copies the answer (`copied`, the shell's own, going
/// like `done`) and stays until it is acted on or replaced. The options card and the answer card
/// take the keyboard (``takesKeyboard``).
public struct CommandProgressState: Equatable, Sendable {
  public enum Phase: Equatable, Sendable {
    /// The run is going: the command's name, and the values it runs with when it has options
    /// to change.
    case working(command: String, summary: String? = nil)
    /// The command's options, to choose before it runs.
    case choose(command: String, options: [CommandOption])
    /// The answer is being written into the target.
    case writing
    /// The answer is written.
    case done
    /// The run ended without writing its answer: why, in the page's words.
    case notice(message: String)
    /// The run's answer, which could not be written: the command's name, the answer as the run
    /// gave it, and why it was not written (the page's words; nil: nothing said).
    case answer(command: String, answer: String, note: String?)
    /// The answer card's answer is on the clipboard.
    case copied
  }

  public struct Shown: Equatable, Sendable {
    public let target: String
    public let phase: Phase
  }

  /// How long a notice stays before it goes by itself.
  public static let noticeDuration: Duration = .seconds(5)
  /// How long "Written" stays before the island collapses.
  public static let doneDuration: Duration = .milliseconds(1500)

  public private(set) var shown: Shown?

  public init() {}

  /// The phase `show` asks for, trimmed; nil when nothing would be left to read.
  public static func phase(_ state: CommandProgressShowParams.State) -> Phase? {
    switch state {
    case .working(let working):
      let command = trimmed(working.command)
      guard !command.isEmpty else { return nil }
      let summary = working.summary.map(trimmed)
      return .working(command: command, summary: summary?.isEmpty == false ? summary : nil)
    case .choose(let choose):
      let command = trimmed(choose.command)
      guard !command.isEmpty, !choose.options.isEmpty else { return nil }
      return .choose(command: command, options: choose.options)
    case .notice(let notice):
      let message = trimmed(notice.message)
      return message.isEmpty ? nil : .notice(message: message)
    case .answer(let answer):
      // The answer shows as the run gave it; only one with nothing to read shows nothing.
      let command = trimmed(answer.command)
      guard !command.isEmpty, !trimmed(answer.answer).isEmpty else { return nil }
      let note = answer.note.map(trimmed)
      return .answer(
        command: command, answer: answer.answer, note: note?.isEmpty == false ? note : nil)
    }
  }

  public mutating func show(target: String, phase: Phase) {
    shown = Shown(target: target, phase: phase)
  }

  /// Takes the island of `target` away; true when it was the one shown.
  @discardableResult
  public mutating func hide(target: String) -> Bool {
    guard shown?.target == target else { return false }
    shown = nil
    return true
  }

  /// Escape cancels only while a run is working; otherwise it stays with the apps, or with the
  /// options card, which reads its own keys.
  public var cancelsWithEscape: Bool {
    if case .working = shown?.phase { return true }
    return false
  }

  /// The shell's own writing and "Written" may show for `target`: nothing shows, or that
  /// target's island does. Another target's island (a run working, its options card, its notice)
  /// is left alone.
  public func letsShellShow(for target: String) -> Bool {
    shown == nil || shown?.target == target
  }

  /// The options card is up: its keys, pointer and filter field drive it.
  public var isChoosing: Bool {
    if case .choose = shown?.phase { return true }
    return false
  }

  /// The answer the answer card shows, which its Copy puts on the clipboard (the shell then
  /// shows `copied`); nil while no answer card is up.
  public var answerShown: String? {
    if case .answer(_, let answer, _) = shown?.phase { return answer }
    return nil
  }

  /// The answer card is up.
  public var isAnswering: Bool { answerShown != nil }

  /// A card is up (options or answer): the island takes the keyboard, and gives it back to the
  /// target's field once the card is gone.
  public var takesKeyboard: Bool { isChoosing || isAnswering }

  /// A command shortcut's press capsule replaces what shows: an outcome (`done`, `copied`, a
  /// notice or an answer card) gives way to it; a run working or its options card stays.
  public var givesWayToPress: Bool {
    switch shown?.phase {
    case .done, .copied, .notice, .answer: true
    case .working, .choose, .writing, nil: false
    }
  }

  /// A press on the island: what it asks the page for, and what the island shows after it.
  /// Cancel while working or choosing, Open on a notice or an answer card, Change on a working
  /// run with a values summary, Run and Edit (with the card's values) while choosing; any other
  /// press changes nothing. Cancel, Open and Edit take the island away. Change keeps the run on screen until
  /// the page shows its options; Run turns the card into the run it starts, until the page shows
  /// that run's own progress.
  public mutating func press(
    _ action: CommandProgressActionEvent.Action, arguments: CommandArguments? = nil
  ) -> CommandProgressActionEvent? {
    guard let shown else { return nil }
    let event = CommandProgressActionEvent(target: shown.target, action: action, arguments: nil)
    switch (action, shown.phase) {
    case (.cancel, .working), (.open, .notice), (.open, .answer), (.cancel, .choose):
      hide(target: shown.target)
      return event
    case (.change, .working(_, .some)):
      return event
    case (.run, .choose(let command, _)):
      guard let arguments else { return nil }
      show(target: shown.target, phase: .working(command: command))
      return CommandProgressActionEvent(target: shown.target, action: .run, arguments: arguments)
    case (.edit, .choose):
      guard let arguments else { return nil }
      hide(target: shown.target)
      return CommandProgressActionEvent(target: shown.target, action: .edit, arguments: arguments)
    default:
      return nil
    }
  }

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
