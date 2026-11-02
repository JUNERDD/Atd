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
/// like `done`) and stays until it is acted on or replaced; with a ``Review`` (the command's
/// answer waits for review) it is the review card, which also asks the page for another version
/// (`regenerate`, `adjust`), steps between versions (`version`), stops a pending one (`stop`) and
/// tells the page once it goes by itself (`close`); the `compose` card, shown where a
/// command was launched with nothing selected, asks for the text (and, when the command takes
/// files, the attachments) that stand in for the selection, and runs, opens or cancels with them.
/// The options card, the answer card and the compose card take the keyboard (``takesKeyboard``).
public struct CommandProgressState: Equatable, Sendable {
  /// What the review card shows besides the answer: the original, the answer's changes, the
  /// versions, the version's options, the command's adjustments and a pending version.
  public typealias Review = CommandProgressShowParams.State.Answer.Review

  public enum Phase: Equatable, Sendable {
    /// The run is going: the command's name, and the values it runs with when it has options
    /// to change.
    case working(command: String, summary: String? = nil)
    /// The command's options and where its answer goes, to choose before it runs.
    case choose(command: String, options: [CommandOption], output: CommandOutputOption)
    /// Nothing was selected: the command's name, and whether it takes files, so the card offers
    /// to attach a screenshot or files besides the text typed in place of the selection.
    case compose(command: String, attach: Bool)
    /// The answer is being written into the target.
    case writing
    /// The answer is written.
    case done
    /// The run ended without writing its answer: why, in the page's words.
    case notice(message: String)
    /// The run's answer, which could not be written or waits for review: the command's name,
    /// the answer as the run gave it, why it was not written (the page's words; nil: nothing
    /// said), and the review, which makes the card the review card.
    case answer(command: String, answer: String, note: String?, review: Review? = nil)
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
      guard !command.isEmpty else { return nil }
      return .choose(command: command, options: choose.options, output: choose.output)
    case .compose(let compose):
      let command = trimmed(compose.command)
      return command.isEmpty ? nil : .compose(command: command, attach: compose.attach)
    case .notice(let notice):
      let message = trimmed(notice.message)
      return message.isEmpty ? nil : .notice(message: message)
    case .answer(let answer):
      // The answer shows as the run gave it; only one with nothing to read shows nothing.
      let command = trimmed(answer.command)
      guard !command.isEmpty, !trimmed(answer.answer).isEmpty else { return nil }
      let note = answer.note.map(trimmed)
      return .answer(
        command: command, answer: answer.answer, note: note?.isEmpty == false ? note : nil,
        review: answer.review)
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
  /// card up, which reads its own keys.
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
    if case .answer(_, let answer, _, _) = shown?.phase { return answer }
    return nil
  }

  /// The answer card is up, the review card included.
  public var isAnswering: Bool { answerShown != nil }

  /// The review the review card shows; nil while no review card is up.
  public var reviewShown: Review? {
    if case .answer(_, _, _, let review?) = shown?.phase { return review }
    return nil
  }

  /// The review card is up.
  public var isReviewing: Bool { reviewShown != nil }

  /// The compose card is up: its field, attachments and keys drive it.
  public var isComposing: Bool {
    if case .compose = shown?.phase { return true }
    return false
  }

  /// A card is up (options, answer or compose): the island takes the keyboard, and gives it back
  /// to the target's field once the card is gone.
  public var takesKeyboard: Bool { isChoosing || isAnswering || isComposing }

  /// A command shortcut's press capsule replaces what shows: an outcome (`done`, `copied`, a
  /// notice or an answer card) gives way to it; a run working, its options card or the compose
  /// card asking for its text stays.
  public var givesWayToPress: Bool {
    switch shown?.phase {
    case .done, .copied, .notice, .answer: true
    case .working, .choose, .compose, .writing, nil: false
    }
  }

  /// A press on the island: what it asks the page for, and what the island shows after it.
  /// Cancel while working, choosing or composing, Open on a notice or an answer card, Change on a
  /// working run with a values summary, Run, Edit and Pick (with the card's values) while
  /// choosing, Run and Open (with what was typed and attached, `compose`) while composing; any
  /// other press changes nothing. Cancel, Open and Edit take the island away; Pick (the card's
  /// values changed) leaves the card as it is. Change keeps the run on screen
  /// until the page shows its options; Run turns the card into the run it starts, until the page
  /// shows that run's own progress.
  ///
  /// On the review card, Regenerate and Adjust (with what the card staged, `adjust`) ask for a
  /// version while it takes one (``Review/takesVersion``), Version shows another of the versions
  /// (`version`) while none is pending, and Stop stops the pending one; each leaves the card as it is until the page shows the outcome. Close takes
  /// the card away.
  public mutating func press(
    _ action: CommandProgressActionEvent.Action, arguments: CommandArguments? = nil,
    compose: CommandProgressActionEvent.Compose? = nil,
    adjust: CommandProgressActionEvent.Adjust? = nil, version: Int? = nil
  ) -> CommandProgressActionEvent? {
    guard let shown else { return nil }
    let target = shown.target
    let event = Self.event(target, action)
    switch (action, shown.phase) {
    case (.cancel, .working), (.open, .notice), (.open, .answer), (.cancel, .choose),
      (.cancel, .compose):
      hide(target: target)
      return event
    case (.change, .working(_, .some)):
      return event
    case (.run, .choose(let command, _, _)):
      guard let arguments else { return nil }
      show(target: target, phase: .working(command: command))
      return Self.event(target, .run, arguments: arguments)
    case (.pick, .choose):
      guard let arguments else { return nil }
      return Self.event(target, .pick, arguments: arguments)
    case (.edit, .choose):
      guard let arguments else { return nil }
      hide(target: target)
      return Self.event(target, .edit, arguments: arguments)
    case (.run, .compose(let command, _)):
      guard let compose else { return nil }
      show(target: target, phase: .working(command: command))
      return Self.event(target, .run, compose: compose)
    case (.open, .compose):
      guard let compose else { return nil }
      hide(target: target)
      return Self.event(target, .open, compose: compose)
    case (.regenerate, .answer(_, _, _, let review?)) where review.takesVersion:
      return event
    case (.adjust, .answer(_, _, _, let review?)) where review.takesVersion:
      guard let adjust else { return nil }
      return Self.event(target, .adjust, adjust: adjust)
    case (.version, .answer(_, _, _, let review?)) where review.pending == nil:
      guard let version, version != review.version, (1...review.count).contains(version) else {
        return nil
      }
      return Self.event(target, .version, version: version)
    case (.stop, .answer(_, _, _, let review?)) where review.pending != nil:
      return event
    case (.close, .answer(_, _, _, .some)):
      hide(target: target)
      return event
    default:
      return nil
    }
  }

  /// What tells the page that the review card of `target` went for good other than through its
  /// own close (Copy, a write that went in or stopped partway, a shortcut's press over it), so
  /// the page lets the review go.
  public static func closing(target: String) -> CommandProgressActionEvent {
    event(target, .close)
  }

  private static func event(
    _ target: String, _ action: CommandProgressActionEvent.Action,
    arguments: CommandArguments? = nil, compose: CommandProgressActionEvent.Compose? = nil,
    adjust: CommandProgressActionEvent.Adjust? = nil, version: Int? = nil
  ) -> CommandProgressActionEvent {
    CommandProgressActionEvent(
      target: target, action: action, arguments: arguments, compose: compose, adjust: adjust,
      version: version)
  }

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
