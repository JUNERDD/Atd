import AtdAI
import AtdActions
import AtdModel
import Foundation
import Observation

/// One command run on what was shared: reading a shared link's page if it must, then a text
/// result in versions or a card, and what the person does with it. Leaving its screen stops it.
@Observable final class ShareRun: Identifiable, Hashable {
  enum Step: Equatable {
    /// Loading the page behind a shared link.
    case readingPage
    /// Waiting for the answer a card is read from.
    case finding(CardKind)
  }

  enum Phase: Equatable {
    case working(Step)
    /// A text result; its versions are in `versions`.
    case text
    /// The card in `card`, to check and act on.
    case card
    /// The card's action happened (`addition`, `logged`).
    case done
    case failed(ShareFailure)
  }

  /// One version of a text result: one choice of `axis`, streamed once and kept.
  struct TextVersion: Equatable {
    enum State: Equatable {
      case streaming
      case finished
      /// The answer hit the output ceiling; what arrived stays.
      case truncated
      case failed(ShareFailure)
    }

    var text = ""
    var state = State.streaming
    /// Which request it belongs to, so a stopped one cannot write into a new one.
    fileprivate var request = UUID()
  }

  let command: Command
  let services: ShareServices
  private(set) var content: SharedContent
  /// Where the run is; only the run moves it on (here and in `ShareRun+Cards.swift`).
  var phase: Phase
  /// Gives the session a shared link's page once it is read, for the next run.
  private let pageRead: (SharedContent) -> Void
  @ObservationIgnored private var task: Task<Void, Never>?

  /// The option the run's screen switches: a text result's versions (译成, 目标) or what
  /// 整理白板 organizes into (整理成); nil for none.
  let axis: CommandOption?
  /// The choice on show: one of `axis`'s choices, or "" without an axis.
  private(set) var choice: String
  private(set) var versions: [String: TextVersion] = [:]
  /// Whether the result on show was copied.
  var copied = false

  // The card side (`ShareRun+Cards.swift`).
  /// The card as the person sees it, edits included.
  var card: CardResult?
  /// What kept the card's action from happening.
  var issue: CardIssue?
  /// The title of an event already in the calendar at the found event's time.
  var clash: String?
  /// Atd may not add to the calendar (or, for notes, to reminders): the action's place shows
  /// what can still be done.
  var denied = false
  /// An action is under way.
  var isBusy = false
  var addition: CalendarAddition?
  var logged: Expense?
  /// The reminders 加到提醒事项 added, which 撤销 removes.
  var reminderIDs: [String]?

  init(
    command: Command, content: SharedContent, services: ShareServices,
    pageRead: @escaping (SharedContent) -> Void = { _ in }
  ) {
    self.command = command
    self.content = content
    self.services = services
    self.pageRead = pageRead
    axis =
      switch command.output.cardKind {
      case .text: command.versionAxis(hasDraft: false)
      case .notes: command.option(NotesFormat.optionKey)
      default: nil
      }
    choice = Self.firstChoice(of: command, axis: axis)
    phase =
      if case .page(let page) = content, page.text == nil {
        .working(.readingPage)
      } else {
        command.output.cardKind == .text ? .text : .working(.finding(command.output.cardKind))
      }
  }

  /// 缩短 starts at 要点 in the share sheet (its third choice) and leaves the command's own
  /// default alone; every other command starts at its remembered choice.
  private static func firstChoice(of command: Command, axis: CommandOption?) -> String {
    guard let axis else { return "" }
    if command.id == BuiltinCommands.shortenID, axis.choices.count > 2 { return axis.choices[2] }
    return axis.value
  }

  private var remembersChoice: Bool {
    command.id != BuiltinCommands.shortenID
  }

  /// Runs from the start: reads the page if it must, then the command.
  func start() {
    task?.cancel()
    task = Task { await run() }
  }

  /// Waits for what is under way (a page, a card's answer, a version's stream) to end.
  func settle() async {
    await task?.value
  }

  /// Stops what is under way; a result already on show stays.
  func stop() {
    task?.cancel()
    task = nil
    if versions[choice]?.state == .streaming { versions[choice] = nil }
  }

  /// Runs again what failed: the version on show, or the whole run.
  func retry() {
    if phase == .text {
      task?.cancel()
      versions[choice] = nil
      task = Task { await stream(choice) }
    } else {
      start()
    }
  }

  private func run() async {
    if case .page(let page) = content, page.text == nil {
      phase = .working(.readingPage)
      do {
        content = .page(try await services.pages.read(page.url))
        pageRead(content)
      } catch {
        if !Task.isCancelled { phase = .failed(ShareFailure(error)) }
        return
      }
    }
    if command.output.cardKind == .text {
      phase = .text
      await stream(choice)
    } else {
      await findCard()
    }
  }

  // MARK: Text results

  /// The version on show.
  var version: TextVersion? {
    versions[choice]
  }

  /// The version on show as a list, when it is one (缩短's 要点 always is).
  var items: [String]? {
    guard let version, version.state != .streaming else { return nil }
    let isPoints = command.id == BuiltinCommands.shortenID && axis?.choices.last == choice
    return ShareText.items(in: version.text, isList: isPoints)
  }

  /// Shows another version, streaming it the first time, or asks for the notes again organized
  /// the other way; the choice is remembered as the command's (翻译's 译成), except 缩短's.
  func select(_ value: String) {
    guard value != choice, let axis, axis.choices.contains(value) else { return }
    stop()
    choice = value
    copied = false
    if remembersChoice { services.remember(value, axis.key, command.id) }
    if command.output.cardKind != .text {
      task = Task { await findCard() }
    } else if versions[value] == nil {
      task = Task { await stream(value) }
    }
  }

  /// Copies the version on show, a list as `· item` lines.
  func copyResult() {
    guard let version, !version.text.trimmed.isEmpty else { return }
    services.copy(items.map(ShareText.copyText(items:)) ?? version.text.trimmed)
    copied = true
  }

  private func stream(_ value: String) async {
    let version = TextVersion()
    versions[value] = version
    let values = axis.map { [$0.key: value] } ?? [:]
    let request = ShareText.request(command, values: values, content: content)
    do {
      for try await delta in services.generator.stream(request, choice: command.model) {
        guard versions[value]?.request == version.request else { return }
        versions[value]?.text += delta
      }
      try Task.checkCancellation()
      // An answer with no text is no result.
      let answered = versions[value]?.text.trimmed.isEmpty == false
      versions[value]?.state = answered ? .finished : .failed(.model(.unreadable(detail: nil)))
    } catch {
      guard !Task.isCancelled, versions[value]?.request == version.request else { return }
      let arrived = versions[value]?.text.trimmed.isEmpty == false
      versions[value]?.state =
        (error as? ModelFailure) == .truncated && arrived
        ? .truncated : .failed(ShareFailure(error))
    }
  }

  // MARK: Identity

  static func == (lhs: ShareRun, rhs: ShareRun) -> Bool {
    lhs === rhs
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(ObjectIdentifier(self))
  }
}
