import AICore
import Foundation
import Observation

/// What the quick asks of a shell card are: a closed set the field shows in order.
typealias IslandQuickAsk = CaseIterable & Hashable & Sendable

/// What a shell card's asking needs its orchestrator for, each after the card applied its own
/// rules (the stop rules, paging to an answer it already has).
enum IslandAskEvent<Ask: CardAsk>: Equatable {
  /// Run this ask on the range kept now and report its answer by id.
  case ask(Ask)
  /// Stop the ask with this id.
  case stop(String)
  /// Run this ask, which asks its `replacing` one's question again on a new answer page.
  case regenerate(Ask)
  /// Hand the task of this ask to the panel ("Open in Atd").
  case open(String)
}

/// Asking Atd about what a shell card keeps (R10, D11), for the recording's result card and the
/// long screenshot's alike: the field's text, the answer slot's pages (``CardAnswers``), how tall
/// the slot's text has grown while the card is open, and the answer's Copy check. Each card owns
/// one, kept with the card while it is shown again. The shared views (``IslandAskField``,
/// ``IslandAskAnswerSlot``) call it; it asks about ``range`` and reports through ``onEvent``, and
/// the card's size may have changed whenever it calls ``onResize``.
@Observable
final class IslandAsking<Ask: CardAsk, Quick: Hashable & Sendable> {
  private(set) var answers = CardAnswers<Ask, Quick>()
  /// The ask field's text.
  var question = ""
  /// The tallest complete answer scroll body while the card is open, up to the cap.
  /// Keeping this natural height prevents paging or thinking from moving the field or pager.
  var answerFloor = 0.0
  /// The shown answer went to the clipboard; its Copy shows a check for a moment.
  private(set) var copiedAnswer = false

  /// The range kept now, which asks and regenerations go on; nil asks nothing.
  @ObservationIgnored var range: () -> Ask.Range? = { nil }
  /// A question is about to be asked (the recording pauses its player first).
  @ObservationIgnored var willAsk: () -> Void = {}
  @ObservationIgnored var onEvent: (IslandAskEvent<Ask>) -> Void = { _ in }
  @ObservationIgnored var onResize: () -> Void = {}
  /// Puts text on the clipboard; false when another write holds it.
  @ObservationIgnored var writeClipboard: (String) -> Bool = { _ in false }
  @ObservationIgnored private var copiedToken = 0

  // Swift 6.2.4's Release optimizer crashes on this generic main-actor class's synthesized
  // deinit below macOS 26, as with IslandPlainHost. Remove when the toolchain is fixed.
  deinit {}

  /// Asks `question` (a quick ask's when `quick`) about the kept range: a repeat pages to its
  /// answer and flashes it; otherwise the ask goes to the orchestrator, after the one still
  /// coming is stopped.
  func ask(_ question: String, quick: Quick? = nil) {
    willAsk()
    guard let range = range() else { return }
    switch answers.ask(question, quick: quick, range: range, id: Self.askID()) {
    case .asked(let ask, let stopping):
      if let stopping { onEvent(.stop(stopping)) }
      onEvent(.ask(ask))
    case .paged:
      break
    }
    onResize()
  }

  /// Regenerate: the shown answer's question is asked again about the range kept now, on a new
  /// page that shows; the shown answer keeps its page.
  func regenerate() {
    guard let range = range(),
      case .asked(let ask, let stopping)? = answers.regenerate(range: range, id: Self.askID())
    else { return }
    if let stopping { onEvent(.stop(stopping)) }
    onEvent(.regenerate(ask))
    onResize()
  }

  /// Stops the answer still coming by the stop rules; false when none is.
  @discardableResult
  func stopAnswer() -> Bool {
    guard let stopped = answers.stop() else { return false }
    onEvent(.stop(stopped))
    onResize()
    return true
  }

  /// The page reported an answer: it shows as it arrives.
  func apply(askID: String, phase: CardAnswerPhase, text: String) {
    guard answers.apply(askID: askID, phase: phase, text: text) else { return }
    onResize()
  }

  func page(by delta: Int) {
    guard answers.page(by: delta) else { return }
    onResize()
  }

  /// Open in Atd: the shown answer's task in the panel, once that answer settled.
  func openAnswer() {
    guard let shown = answers.shown, !shown.phase.running else { return }
    onEvent(.open(shown.askID))
  }

  /// Copies the shown answer once it settled with text.
  func copyAnswer() {
    guard let shown = answers.shown, !shown.phase.running, !shown.text.isEmpty,
      writeClipboard(shown.text)
    else { return }
    copiedToken += 1
    let token = copiedToken
    copiedAnswer = true
    Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard let self, copiedToken == token else { return }
      copiedAnswer = false
    }
  }

  private static func askID() -> String { UUID().uuidString }
}

/// The shared ask field's and answer slot's copy for one shell card, in the shell language
/// (built again when it changes): the card's own field, default question and quick asks, and
/// what both cards' slots say alike, which is the recording card's copy
/// (``RecordingIslandStringKey``).
struct IslandAskLabels<Quick: IslandQuickAsk>: Equatable {
  var askPlaceholder = ""
  var askLabel = ""
  /// What an empty field asks.
  var askDefault = ""
  /// The quick asks' questions, which are also what they send.
  var quickAsks: [Quick: String] = [:]
  var send = ""
  var answering = ""
  var rangeTooltip = ""
  var stop = ""
  var previousAnswer = ""
  var nextAnswer = ""
  var regenerate = ""
  var copyAnswer = ""
  var openTooltip = ""
  var stopped = ""
  var failed = ""
  private var runningFormat = ""
  private var questionFormat = ""
  private var pagerFormat = ""
  private var language = ""

  static func current(
    placeholder: String, label: String, question: String, quickAsks: [Quick: String]
  ) -> Self {
    let strings = ShellStrings.shared
    let text: (RecordingIslandStringKey) -> String = { strings.text($0) }
    var labels = Self(
      askPlaceholder: placeholder, askLabel: label, askDefault: question, quickAsks: quickAsks)
    labels.send = text(.send)
    labels.answering = text(.answering)
    labels.rangeTooltip = text(.rangeTooltip)
    labels.stop = text(.stop)
    labels.previousAnswer = text(.previousAnswer)
    labels.nextAnswer = text(.nextAnswer)
    labels.regenerate = text(.regenerate)
    labels.copyAnswer = text(.copyAnswer)
    labels.openTooltip = text(.openTooltip)
    labels.stopped = text(.stopped)
    labels.failed = text(.failed)
    labels.runningFormat = text(.running)
    labels.questionFormat = text(.question)
    labels.pagerFormat = text(.pager)
    labels.language = strings.language.rawValue
    return labels
  }

  /// The question a quick ask sends, in the shell language.
  func question(_ quick: Quick) -> String { quickAsks[quick] ?? "" }

  /// What a running answer's title says: the quick ask running, or that it is answering.
  func running(_ quick: String?) -> String { quick.map { format(runningFormat, $0) } ?? answering }

  /// A typed question as an answer's title.
  func question(_ question: String) -> String { format(questionFormat, question) }

  func pager(_ page: Int, of count: Int) -> String {
    format(pagerFormat, String(page), String(count))
  }

  private func format(_ template: String, _ arguments: String...) -> String {
    String(format: template, locale: Locale(identifier: language), arguments: arguments)
  }
}
