import Foundation

/// One command run on text in a screenshot (`captureText.run`) as its surface keeps it: the
/// paragraphs it reads under the ids the bridge knows them by, the answer as it grows and then the
/// version of it shown (`captureText.progress`, ``apply(_:in:copied:)``), where the result goes
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
  public internal(set) var burst = UUID()
  public private(set) var output: CommandOutputAction
  public private(set) var phase = Phase.thinking
  /// The answer as shown on the card (outputs other than the three on the image), or what the run
  /// said when it failed.
  public private(set) var text = ""
  /// The text before the answer's first piece: an overall meaning.
  public internal(set) var lead = ""
  /// Every completed piece of the answer about a paragraph the run reads, in the answer's order.
  public internal(set) var items: [Item] = []
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
  public internal(set) var accepted = false
  /// The version whose text the shell put on the clipboard under a `copy` output (1 for an answer
  /// without versions); nil before then or otherwise.
  public private(set) var copied: Int?
  /// The annotations each applied item put on the image, by its index in ``items``.
  public internal(set) var applied: [Int: [UUID]] = [:]
  /// What another version put on the image, which the next landing takes off in the same undo
  /// step as the version shown now lands.
  public internal(set) var superseded: Set<UUID> = []
  /// Each version as it landed, and the one on the image.
  public internal(set) var landings = CaptureTextLandings()
  /// What each item drew before its result went off the image, which it draws under again when
  /// Reapply lands it (``reapply(in:)``), so undo and redo keep meeting the same annotations.
  var redrawn: [Int: [UUID]] = [:]

  /// Every paragraph the run's versions read, by its id in the run.
  private var known: [String: CaptureTextParagraph]
  /// The version an undo or a redo brought back onto the image (``follow(_:)``) until the page
  /// shows it too: updates still showing another version leave the run's items as they are.
  var following: Int?
  /// The version ``lead`` and ``items`` currently show; nil before the first version settles.
  var shownVersion: Int?

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

  /// Synthetic command id used when Ask Atd runs on screenshot text rather than a saved command.
  public static let askID = "@ask"

  /// The event that starts the run on the panel's page, with the files the shell imported.
  public func event(
    surface: CaptureTextRunEvent.Surface, commandId: String? = nil, question: String? = nil,
    arguments: CommandArguments?, files: [FileRef]
  ) -> CaptureTextRunEvent {
    CaptureTextRunEvent(
      runId: id, surface: surface, commandId: commandId, question: question, arguments: arguments,
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

  /// Takes `update`, the run's latest state, against `document` (what currently stands on the
  /// image) when it is this run's; false otherwise. Pieces about a paragraph the run does not read
  /// are dropped. An update that ends the run without a result (a failure, or the shell's own when
  /// the page went away) keeps the pieces the run had, as the image does. A final state is not the
  /// last word under review: a first version stopped with pieces of its answer comes back `done`
  /// with a review, which starts it.
  @discardableResult
  public mutating func apply(
    _ update: CaptureTextProgressParams, in document: AnnotationDocument, copied: Bool? = nil
  ) -> Bool {
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
      let initialVersion = shownVersion == nil
      let versionChanged =
        !initialVersion && review?.version != nil && review?.version != shownVersion
      shownVersion = review?.version
      lead = result.lead
      show(
        result.items.filter { known[$0.paragraph] != nil }, in: document,
        initialVersion: initialVersion, versionChanged: versionChanged)
    } else if phase.running {
      lead = ""
      items = []
    }
    if copied == true { self.copied = review?.version ?? 1 }
    if allAppliedStand(in: document) { remember() }
    return true
  }
}
