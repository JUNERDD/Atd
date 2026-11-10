/// How an answer of a shell card's answer slot stands, as the page reports it (`recording.answer`'s
/// state). The recording's and the long screenshot's cards share it, so one bridge call answers
/// either card.
public enum CardAnswerPhase: String, Sendable {
  case thinking, streaming, done, stopped, failed

  /// Still coming: the slot offers Stop instead of its tools.
  public var running: Bool { self == .thinking || self == .streaming }
}

/// What a shell card's ask is about: the part of the capture it keeps when asked (a recording's
/// trim, a long screenshot's kept range). Two asks whose ranges have equal keys are about the same
/// range, at the finest step the card's handles move.
public protocol CardAskRange: Equatable, Sendable {
  var askKey: [Int] { get }
}

/// An ask a shell card sends: the orchestrator runs it as a light task on the kept range's files
/// and reports its answer back by `id`. A regeneration names the ask it `replacing`, whose page it
/// takes over.
public protocol CardAsk: Equatable, Sendable {
  associatedtype Range: CardAskRange
  init(id: String, question: String, range: Range, replacing: String?)
}

/// One answer page of a shell card's answer slot.
public struct CardAnswer<Range: CardAskRange, Quick: Hashable & Sendable>: Equatable, Sendable {
  public typealias Phase = CardAnswerPhase

  /// The ask running on this page now; a regeneration gives the page a new one.
  public fileprivate(set) var askID: String
  public let question: String
  /// The quick ask it was, whose chip is marked while the page shows; nil for a typed question.
  public let quick: Quick?
  /// The range kept when it was asked (or regenerated).
  public fileprivate(set) var range: Range
  public fileprivate(set) var phase: Phase
  public fileprivate(set) var text: String
  /// What a regeneration replaced, back if it is stopped before any of it arrives.
  fileprivate var previous: Previous?

  fileprivate struct Previous: Equatable, Sendable {
    let askID: String
    let range: Range
    let phase: Phase
    let text: String
  }

  /// The same question about the same range is the same ask.
  func asks(_ question: String, about range: Range) -> Bool {
    self.question == question && self.range.askKey == range.askKey
  }
}

/// A shell card's one answer slot (R10, `record-answer.js`): asking more never stacks answers but
/// adds a page of the same slot, `‹ n / m ›`. The same question about the same kept range pages
/// to its answer and flashes it instead of asking again; Regenerate replaces a page in place. At
/// most one ask runs: a new one, or a regeneration, stops it first by the stop rules
/// (``stop()``).
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
    if let same = pages.firstIndex(where: { $0.asks(question, about: range) }) {
      current = same
      flash += 1
      return .paged
    }
    let stopping = stop()
    pages.append(
      Page(askID: id, question: question, quick: quick, range: range, phase: .thinking, text: ""))
    current = pages.count - 1
    return .asked(
      Ask(id: id, question: question, range: range, replacing: nil), stopping: stopping)
  }

  /// Asks the shown page's question again as ask `id`, about `range`, in its place. Nil while
  /// nothing shows or the shown page is still coming.
  public mutating func regenerate(range: Ask.Range, id: String) -> Asked? {
    guard let shown = current, !pages[shown].phase.running else { return nil }
    let replaced = pages[shown].askID
    let stopping = stop()
    // Stopping a new ask removes its page, which may move this one.
    guard let current = pages.firstIndex(where: { $0.askID == replaced }) else { return nil }
    self.current = current
    var page = pages[current]
    page.previous = .init(askID: replaced, range: page.range, phase: page.phase, text: page.text)
    page.askID = id
    page.range = range
    page.phase = .thinking
    page.text = ""
    pages[current] = page
    return .asked(
      Ask(id: id, question: page.question, range: range, replacing: replaced),
      stopping: stopping)
  }

  /// Stops the ask still coming, by the stop rules: a new question still thinking goes, a
  /// regeneration still thinking brings back the answer it replaced, and an answer already
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
      pages[index].previous = nil
    case .stopped:
      guard pages[index].phase.running else { return false }
      settleStopped(at: index, text: text)
    case .failed:
      pages[index].phase = .failed
      pages[index].text = text
      pages[index].previous = nil
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

  private mutating func settleStopped(at index: Int, text: String?) {
    let page = pages[index]
    let arrived = text ?? page.text
    if page.phase == .thinking, arrived.isEmpty {
      if let previous = page.previous {
        pages[index].askID = previous.askID
        pages[index].range = previous.range
        pages[index].phase = previous.phase
        pages[index].text = previous.text
        pages[index].previous = nil
      } else {
        pages.remove(at: index)
        current = pages.isEmpty ? nil : pages.count - 1
      }
      return
    }
    pages[index].phase = .stopped
    pages[index].text = arrived
    pages[index].previous = nil
  }
}
