import Foundation

/// One command run on text in a screenshot (`captureText.run`) as its surface keeps it: the
/// paragraphs it reads under the ids the bridge knows them by, the answer as it grows and then the
/// version of it shown (`captureText.progress`, ``apply(_:copied:)``), where the result goes
/// (``destination``), and which annotations each applied piece of the answer put on the image, so
/// the run can be taken off again or swapped for another of its versions (``landings``). A value,
/// rebuilt by every update; the surface holds the runs of its image together
/// (``CaptureTextRuns``).
public struct CaptureTextRun: Equatable, Sendable {
  /// Where the run is, as its latest update says.
  public enum Phase: Equatable, Sendable {
    case thinking, streaming, done, stopped, failed

    init(_ state: CaptureTextProgressParams.State) {
      switch state {
      case .thinking: self = .thinking
      case .streaming: self = .streaming
      case .done: self = .done
      case .stopped: self = .stopped
      case .failed: self = .failed
      }
    }

    /// Still producing: a run Escape stops.
    public var running: Bool { self == .thinking || self == .streaming }
  }

  /// A paragraph the run reads, under its id in the run.
  public struct Paragraph: Equatable, Sendable {
    public let id: String
    public let paragraph: CaptureTextParagraph
  }

  /// One completed piece of the answer (contract: `captureText.progress`'s `result.items`).
  public typealias Item = CaptureTextProgressParams.Result.Item
  public typealias Review = CaptureTextProgressParams.Review

  public let id: String
  /// The command it runs, by id: running it again on the same text makes another version of this
  /// run rather than another run (``CaptureTextRuns/again(_:output:reading:)``).
  public let commandId: String
  /// The command's name, user data shown untranslated.
  public let command: String
  /// How the person chose what the run reads now, and the paragraphs it reads, in order: what its
  /// first version read, then what a retry on another selection read (``rescope(_:scope:)``).
  public private(set) var scope: CaptureTextScope
  public private(set) var paragraphs: [Paragraph]
  /// The undo burst the run's commits share (``AnnotationStore/commit(_:burst:)``), so what lands
  /// piece by piece is one undo step; a version that replaces another on the image starts a burst
  /// of its own, so undo steps back through the versions.
  public private(set) var burst = UUID()
  public private(set) var output: CommandOutputAction
  public private(set) var phase = Phase.thinking
  /// The answer as shown on the card (outputs other than the three on the image), or what the run
  /// said when it failed.
  public private(set) var text = ""
  /// The text before the answer's first piece: an overall meaning.
  public private(set) var lead = ""
  /// Every completed piece of the answer about a paragraph the run reads, in the answer's order.
  public private(set) var items: [Item] = []
  /// The run's versions (`captureText.progress`'s `review`): present once its first answer became
  /// version 1, and while the first version of an answer that awaits applying is made. From then
  /// on ``text``, ``lead`` and ``items`` are the version shown.
  public private(set) var review: Review?
  /// The version being made while the run has versions (`review.pending`), as its answer grows
  /// (``Draft``); nil while none is.
  public private(set) var draft: Draft?
  /// The answer waits for the person to apply it before it lands (`awaitsApply`): nothing of it
  /// lands until they do, even once a final update without a version (it stopped or failed) ends
  /// the run.
  public private(set) var gated = false
  /// The person applied the gated answer: it, and every version after it, lands like an ungated
  /// one.
  public private(set) var accepted = false
  /// The version whose text the shell put on the clipboard under a `copy` output (1 for an answer
  /// without versions); nil before then or otherwise.
  public private(set) var copied: Int?
  /// The annotations each applied item put on the image, by its index in ``items``.
  public private(set) var applied: [Int: [UUID]] = [:]
  /// What another version put on the image, which the next landing takes off in the same undo
  /// step as the version shown now lands.
  public private(set) var superseded: Set<UUID> = []
  /// Each version as it landed, and the one on the image.
  public private(set) var landings = CaptureTextLandings()
  /// What each item drew before its result went off the image, which it draws under again when
  /// Reapply lands it (``reapply(in:)``), so undo and redo keep meeting the same annotations.
  private(set) var redrawn: [Int: [UUID]] = [:]

  /// Every paragraph the run's versions read, by its id in the run.
  private var known: [String: CaptureTextParagraph]
  /// The version an undo or a redo brought back onto the image (``follow(_:)``) until the page
  /// shows it too: updates still showing another version leave the run's items as they are.
  private var following: Int?

  /// A run of command `commandId` (named `command`) reading `paragraphs` (in the order given; at
  /// least one) as `scope` says, whose answer goes to `output` (the run's picked output, else the
  /// command's saved one), under `id`.
  public init(
    id: String = Self.mintID(), commandId: String, command: String, scope: CaptureTextScope,
    paragraphs: [CaptureTextParagraph], output: CommandOutputAction
  ) {
    self.id = id
    self.commandId = commandId
    self.command = command
    self.scope = scope
    self.output = output
    self.paragraphs = paragraphs.enumerated().map {
      Paragraph(id: Self.paragraphID($0.offset), paragraph: $0.element)
    }
    known = Dictionary(uniqueKeysWithValues: self.paragraphs.map { ($0.id, $0.paragraph) })
  }

  /// A fresh run id: letters, digits and dashes, as the bridge requires.
  public static func mintID() -> String { "ct-" + UUID().uuidString.lowercased() }

  /// The event that starts the run on the panel's page, with the files the shell imported.
  public func event(
    surface: CaptureTextRunEvent.Surface, commandId: String, arguments: CommandArguments?,
    files: [FileRef]
  ) -> CaptureTextRunEvent {
    CaptureTextRunEvent(
      runId: id, surface: surface, commandId: commandId, arguments: arguments,
      scope: scope.bridge,
      paragraphs: paragraphs.map { .init(id: $0.id, text: $0.paragraph.text) }, files: files)
  }

  /// The paragraph the run knows as `id`, whichever of its versions read it.
  public subscript(paragraph id: String) -> CaptureTextParagraph? { known[id] }

  /// A retry reads `reading`, what the person's selection holds now (`scope` says how it was
  /// chosen): when that is not what the run reads, in any order, the run reads it from its next
  /// version on and returns it under the run's ids for the page (`captureText.action`'s
  /// `reading`). A paragraph read before keeps its id and a new one takes the next unused id, so
  /// earlier versions keep their pieces; what longer ids push past one run's selection is left
  /// out. Nil when the run reads those paragraphs already.
  public mutating func rescope(_ reading: [CaptureTextParagraph], scope: CaptureTextScope)
    -> [Paragraph]?
  {
    let wanted = Set(reading.map(\.readingKey))
    guard !reading.isEmpty, wanted != Set(paragraphs.map(\.paragraph.readingKey)) else {
      return nil
    }
    var ids = Dictionary(known.map { ($1.readingKey, $0) }, uniquingKeysWith: { first, _ in first })
    var next = known.count
    let named = reading.map { paragraph in
      let id = ids[paragraph.readingKey] ?? Self.paragraphID(next)
      if ids[paragraph.readingKey] == nil {
        ids[paragraph.readingKey] = id
        next += 1
      }
      return Paragraph(id: id, paragraph: paragraph)
    }
    let kept = Array(named.prefix(Self.fitting(named.lazy.map { ($0.id, $0.paragraph.text) })))
    for paragraph in kept { known[paragraph.id] = paragraph.paragraph }
    paragraphs = kept
    self.scope = scope
    return kept
  }

  /// The answer waits for the person to apply it: nothing lands until they do.
  public var awaitsReview: Bool { gated && !accepted }

  /// A version waits for the person to apply it (the card's Apply).
  public var awaitsApply: Bool { awaitsReview && review != nil }

  /// Another version is being made; the one shown stays on the image and the card meanwhile.
  public var remaking: Bool { review?.pending != nil }

  /// The run's first version came, so the page takes its versions' presses (`again` included):
  /// a gated answer's first version shows as being made before it does.
  public var versioned: Bool { review != nil && !(phase.running && review?.pending == nil) }

  /// The phase the card shows the version by: once the run has versions, an attempt at another
  /// one that failed or stopped leaves the version shown as it was.
  public var shownPhase: Phase { review != nil && !phase.running ? .done : phase }

  /// The items the version under review would put on the image, in order: the dashed preview
  /// the surface draws (``CaptureTextMarks/preview(_:over:context:)``). None once the person
  /// applied it, or once the run ended without a version to apply.
  public var previewed: [Int] {
    guard awaitsApply else { return [] }
    return items.indices.filter { applied[$0] == nil && destination.draws(items[$0].tool) }
  }

  /// Takes `update`, the run's latest state, when it is this run's; false otherwise. Pieces about
  /// a paragraph the run does not read are dropped. An update that ends the run without a result
  /// (a failure, or the shell's own when the page went away) keeps the pieces the run had, as the
  /// image does. A final state is not the last word under review: a first version stopped with
  /// pieces of its answer comes back `done` with a review, which starts it.
  @discardableResult
  public mutating func apply(_ update: CaptureTextProgressParams, copied: Bool? = nil) -> Bool {
    guard update.runId == id else { return false }
    output = update.output
    phase = Phase(update.state)
    text = update.text
    gated = update.awaitsApply
    review = update.review
    draft = review?.pending == nil ? nil : Draft(update.draft) { known[$0] != nil }
    if let following, review?.version != following {
      // The page has not shown the version the image went back to yet: the image's stays.
    } else if let result = update.result {
      following = nil
      lead = result.lead
      show(result.items.filter { known[$0.paragraph] != nil })
    } else if phase.running {
      lead = ""
      items = []
    }
    if copied == true { self.copied = review?.version ?? 1 }
    remember()
    return true
  }

  /// Takes `next` as the items shown. While the answer grows (its first version streaming, then
  /// whole) the pieces on the image stay and the rest lands after them in the same undo step;
  /// once the version shown puts something else there, everything the run has on the image goes
  /// as that version lands, an undo step of its own (``superseded``). Nothing lands or goes while
  /// the answer waits for review.
  private mutating func show(_ next: [Item]) {
    defer { items = next }
    guard !awaitsReview, next != items else { return }
    let growing = landings.current == nil || landings.current == review?.version
    if growing, next.starts(with: items) { return }
    superseded.formUnion(annotationIDs)
    applied = [:]
    redrawn = [:]
    burst = UUID()
  }

  /// Records the version shown as landed once all of it is on the image (not while the image shows
  /// one the page has not caught up with).
  private mutating func remember() {
    guard let version = review?.version, following == nil, !awaitsReview, superseded.isEmpty,
      unapplied.isEmpty
    else { return }
    landings.record(version, .init(lead: lead, items: items, applied: applied))
  }

  /// Undo or redo left `present` (annotation ids) on the image: when nothing the run has there is
  /// among them but another version it landed is, the run takes that version's items and
  /// annotations as its own and returns its number, for the card to show (`captureText.action`'s
  /// `version`) without landing it again. Nil otherwise: the run keeps its version, also when
  /// none of its versions is on the image any more (the version chosen next lands then).
  public mutating func follow(_ present: Set<UUID>) -> Int? {
    guard review != nil, !awaitsReview, superseded.isEmpty,
      annotationIDs.isDisjoint(with: present), let version = landings.version(in: present),
      let landing = landings[version]
    else { return nil }
    lead = landing.lead
    items = landing.items
    applied = landing.applied
    landings.follow(version)
    following = version == review?.version ? nil : version
    return following
  }

  /// The person applied the version under review (the card's Apply): its pieces land now.
  public mutating func accept() {
    guard awaitsApply else { return }
    accepted = true
  }

  /// The items that should be on the image but are not yet, in order: none while the answer
  /// waits for review or the run puts nothing on the image.
  public var unapplied: [Int] {
    guard !awaitsReview else { return [] }
    return items.indices.filter { applied[$0] == nil && destination.draws(items[$0].tool) }
  }

  /// Something waits to land: items not on the image yet, or another version to take off.
  public var needsLanding: Bool { !unapplied.isEmpty || !superseded.isEmpty }

  /// The landing that took ``superseded`` off the image put `produced` there: the annotations
  /// each item drew (none: it drew nothing, which still counts as applied).
  public mutating func landed(_ produced: [(item: Int, ids: [UUID])]) {
    superseded = []
    redrawn = [:]
    for (item, ids) in produced where items.indices.contains(item) { applied[item] = ids }
    remember()
  }

  /// Every annotation the run put on the image.
  public var annotationIDs: Set<UUID> { Set(applied.values.joined()) }

  /// Everything the run put on the image is off it in `document`: its card's Restore, an undo or
  /// the person took it off.
  public func restored(in document: AnnotationDocument) -> Bool {
    let ids = annotationIDs
    return !ids.isEmpty && ids.allSatisfy { document[$0] == nil }
  }

  /// The card's Reapply: the result taken off `document` lands again, as one undo step.
  public mutating func reapply(in document: AnnotationDocument) {
    guard restored(in: document) else { return }
    redrawn = applied
    applied = [:]
    burst = UUID()
  }

  /// Progress through a run that replaces: paragraphs replaced so far, and how many it reads.
  public var replaced: (done: Int, total: Int) {
    (
      items.indices.filter { applied[$0] != nil && items[$0].tool == .replace }.count,
      paragraphs.count
    )
  }

  /// The number each step item shows on the image now, by item index: its badge's place among
  /// the document's steps (numbers continue after the steps drawn before). An item whose badge
  /// was deleted, or that has not landed yet, has none.
  public func stepNumbers(in document: AnnotationDocument) -> [Int: Int] {
    var numbers: [Int: Int] = [:]
    for (item, ids) in applied where items.indices.contains(item) && items[item].tool == .step {
      if let number = ids.lazy.compactMap({ document.stepNumber(of: $0) }).first {
        numbers[item] = number
      }
    }
    return numbers
  }
}
