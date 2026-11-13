/// How an answer of a shell card's answer slot stands, as the page reports it (`recording.answer`'s
/// state). The recording's and the long screenshot's cards share it, so one bridge call answers
/// either card.
public enum CardAnswerPhase: String, Sendable {
  case thinking, streaming, done, stopped, failed

  /// Still coming: the slot offers Stop in Regenerate's place, and Copy and Open wait.
  public var running: Bool { self == .thinking || self == .streaming }
}

/// What a shell card's ask is about: the part of the capture it keeps when asked (a recording's
/// trim, a long screenshot's kept range). Two asks whose ranges have equal keys are about the same
/// range, at the finest step the card's handles move.
public protocol CardAskRange: Equatable, Sendable {
  var askKey: [Int] { get }
}

/// An ask a shell card sends: the orchestrator runs it as a light task on the kept range's files
/// and reports its answer back by `id`. A regeneration names the ask whose answer it asks again
/// (`replacing`); that answer keeps its own page.
public protocol CardAsk: Equatable, Sendable {
  associatedtype Range: CardAskRange
  init(id: String, question: String, range: Range, replacing: String?)
}

/// One answer page of a shell card's answer slot: one ask and the answer it brought.
public struct CardAnswer<Range: CardAskRange, Quick: Hashable & Sendable>: Equatable, Sendable {
  public typealias Phase = CardAnswerPhase

  /// The ask this page answers, which names it for as long as it stays.
  public let askID: String
  public let question: String
  /// The quick ask it was, whose chip is marked while the page shows; nil for a typed question.
  public let quick: Quick?
  /// The range kept when it was asked.
  public let range: Range
  /// A page starts thinking, with no text.
  public fileprivate(set) var phase: Phase = .thinking
  public fileprivate(set) var text = ""
  /// A regeneration's: the ask whose page it asks again, which shows again if this one is
  /// stopped before any of it arrives.
  fileprivate let regenerating: String?

  /// The same question about the same range is the same ask.
  func asks(_ question: String, about range: Range) -> Bool {
    self.question == question && self.range.askKey == range.askKey
  }
}

/// A shell card's one answer slot (R10, `record-answer.js`): asking more never stacks answers but
/// adds a page of the same slot, `‹ n / m ›`, and shows it. The same question about the same kept
/// range pages to its newest answer and flashes it instead of asking again; Regenerate asks the
/// shown page's question again on a new page, keeping the answer it had. At most one ask runs,
/// always on the last page: a new one, or a regeneration, stops it first by the stop rules
/// (``stop()``). Paging is free while it runs.
public struct CardAnswers<Ask: CardAsk, Quick: Hashable & Sendable>: Equatable, Sendable {
  public typealias Page = CardAnswer<Ask.Range, Quick>

  public private(set) var pages: [Page] = []
  /// The page shown; nil while there is none.
  public private(set) var current: Int?
  /// Bumped when an ask pages to the answer it already has, which the slot flashes.
  public private(set) var flash = 0

  public init() {}

  public var shown: Page? { current.map { pages[$0] } }

  /// The page whose ask is still coming, if any.
  public var running: Page? { pages.first { $0.phase.running } }

  /// What asking did.
  public enum Asked: Equatable, Sendable {
    /// `ask` went out, after the running ask `stopping` (when not nil) was stopped.
    case asked(Ask, stopping: String?)
    /// The same question about the same range has a page already: it shows, and flashes.
    case paged
  }

  /// Asks `question` (a quick ask's when `quick`) about `range` as ask `id`.
  public mutating func ask(
    _ question: String, quick: Quick? = nil, range: Ask.Range, id: String
  ) -> Asked {
    // A regenerated question has several pages; the newest is its answer now.
    if let same = pages.lastIndex(where: { $0.asks(question, about: range) }) {
      current = same
      flash += 1
      return .paged
    }
    let stopping = stop()
    add(Page(askID: id, question: question, quick: quick, range: range, regenerating: nil))
    return .asked(
      Ask(id: id, question: question, range: range, replacing: nil), stopping: stopping)
  }

  /// Asks the shown page's question again as ask `id`, about `range`, on a new page that shows;
  /// the shown page keeps its answer. Nil while nothing shows or the shown page is still coming.
  public mutating func regenerate(range: Ask.Range, id: String) -> Asked? {
    guard let shown, !shown.phase.running else { return nil }
    let stopping = stop()
    add(
      Page(
        askID: id, question: shown.question, quick: shown.quick, range: range,
        regenerating: shown.askID))
    return .asked(
      Ask(id: id, question: shown.question, range: range, replacing: shown.askID),
      stopping: stopping)
  }

  /// Stops the ask still coming, by the stop rules: an ask still thinking takes its page away
  /// (showing, if it was shown, the page a regeneration asked again), and an answer already
  /// arriving keeps what came, marked stopped. Answers the stopped ask's id.
  @discardableResult
  public mutating func stop() -> String? {
    guard let index = pages.firstIndex(where: { $0.phase.running }) else { return nil }
    let askID = pages[index].askID
    settleStopped(at: index, text: nil)
    return askID
  }

  /// The page reported ask `askID`: `phase` with the answer's `text` so far. A report for an ask
  /// no page runs any more (one stopped here, say) changes nothing; false then.
  @discardableResult
  public mutating func apply(askID: String, phase: CardAnswerPhase, text: String) -> Bool {
    guard let index = pages.firstIndex(where: { $0.askID == askID }) else { return false }
    switch phase {
    case .thinking:
      guard pages[index].phase.running else { return false }
      pages[index].phase = .thinking
    case .streaming, .done:
      guard pages[index].phase.running else { return false }
      pages[index].phase = phase
      pages[index].text = text
    case .stopped:
      guard pages[index].phase.running else { return false }
      settleStopped(at: index, text: text)
    case .failed:
      pages[index].phase = .failed
      pages[index].text = text
    }
    return true
  }

  /// Shows the page `delta` pages away, within the pages; false when it stays.
  @discardableResult
  public mutating func page(by delta: Int) -> Bool {
    guard let current else { return false }
    let next = min(max(current + delta, 0), pages.count - 1)
    guard next != current else { return false }
    self.current = next
    return true
  }

  /// Adds `page`, thinking, as the last page and shows it.
  private mutating func add(_ page: Page) {
    pages.append(page)
    current = pages.count - 1
  }

  private mutating func settleStopped(at index: Int, text: String?) {
    let arrived = text ?? pages[index].text
    guard pages[index].phase != .thinking || !arrived.isEmpty else { return remove(at: index) }
    pages[index].phase = .stopped
    pages[index].text = arrived
  }

  /// Takes the page at `index` away. The page shown stays shown; when it was this one, the page
  /// it regenerated shows again, else the last.
  private mutating func remove(at index: Int) {
    let removed = pages.remove(at: index)
    guard let shown = current else { return }
    if pages.isEmpty {
      current = nil
    } else if shown == index {
      current =
        removed.regenerating.flatMap { id in pages.firstIndex { $0.askID == id } }
        ?? pages.count - 1
    } else if shown > index {
      current = shown - 1
    }
  }
}
