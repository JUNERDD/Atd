import Foundation

/// What the result card shows for a text command run (the plan's 「一张结果卡」, modelled on the
/// island's command result card): the command's name, a note on what it read and where the result
/// went, the answer or what lands on the image, the run's versions once it has them
/// (``versions``) with the one being made as it grows (``draft``), and one footer row of key hints
/// and actions. It is derived from the run and the
/// image's annotations whenever either changes, so step numbers and deleted badges follow the
/// image. The shell turns the notes, hints and actions into words.
public struct CaptureResultCard: Equatable, Sendable {
  /// One phrase of the note under the title, after the scope; ``reading``, ``writing`` and
  /// ``making(_:)`` stand alone (the first names the scope itself).
  public enum Note: Equatable, Sendable {
    case reading
    case writing
    case replacing(done: Int, total: Int)
    case replaced(Int)
    case steps(first: Int, last: Int)
    case highlights(Int)
    case unchanged
    case copied
    case nothing
    /// What the run put on the image is off it again; Reapply puts it back.
    case restored
    /// A replacement waits for review: version `version` of `count` shows.
    case review(version: Int, count: Int)
    /// Steps or highlighter marks wait for review: version `version` of `count` shows.
    case reviewMarks(version: Int, count: Int)
    /// The version of this number is being made; the one shown stays meanwhile.
    case making(Int)
    /// The latest attempt at another version made none; the one shown stays.
    case versionFailed
    case stopped
    case failed
  }

  /// What sits between the note and the footer.
  public enum Body: Equatable, Sendable {
    /// Nothing: the result is on the image.
    case none
    /// Placeholder lines until the first text arrives.
    case skeleton
    /// The answer, plain text as the island's answer card shows it.
    case answer(String)
    /// An optional lead, then one item per step (numbered as its badge, or its preview badge under
    /// review) or noted highlight.
    case items(lead: String, [Entry])
    /// Each replaced paragraph's new text over its original, in the answer's order: what the
    /// version shown put on the image, or would put there under review, as it grows.
    case replacements([Replacement])
  }

  /// One paragraph a replacement covers.
  public struct Replacement: Equatable, Sendable, Identifiable {
    /// The item's index in the run (``CaptureTextRun/items``), which lights and flashes its
    /// paragraph as an explanation's item does.
    public let id: Int
    /// The paragraph's recognized text.
    public let original: String
    /// The text that replaces it.
    public let text: String
  }

  /// One item of an answer about paragraphs.
  public struct Entry: Equatable, Sendable, Identifiable {
    public enum Marker: Equatable, Sendable {
      /// The number its badge shows on the image.
      case number(Int)
      /// Its badge was deleted from the image: shown dimmed.
      case gone
      /// Its badge has not landed yet.
      case pending
      /// A highlighter mark's note.
      case highlight
    }

    /// The item's index in the run (``CaptureTextRun/items``).
    public let id: Int
    /// The paragraph it is about, by its id in the run.
    public let paragraph: String
    public let marker: Marker
    public let text: String
  }

  /// The run's versions as the card's pager, Regenerate and adjust field work with them.
  public struct Versions: Equatable, Sendable {
    /// The version shown, from 1, of ``count``.
    public let version: Int
    public let count: Int
    /// A version is being made (another one, or under review the first): Regenerate and the
    /// adjust field rest, and so do the footer's actions (``CaptureResultCard/busy``).
    public let pending: Bool
    /// Another version is being made (``CaptureResultCard/draft``): it is the pager's newest page,
    /// after the versions made, which the pager keeps paging through meanwhile.
    public let drafting: Bool
    public let adjustments: [String]

    /// The pages the pager steps through: the versions made, then the one being made.
    public var pages: Int { count + (drafting ? 1 : 0) }

    /// The run may make no more versions.
    public var full: Bool { count >= CommandProgressState.Review.maxVersions }

    /// The run may make another version now.
    public var takesVersion: Bool { !pending && !full }
  }

  public enum Action: Equatable, Sendable {
    /// Takes the run's result off the image.
    case revert
    /// Puts the result Restore took off back on the image, in Restore's place.
    case reapply
    /// Copies the answer, or an explanation's notes.
    case copy
    /// Copies the image with its changes, without ending the surface.
    case copyScreenshot
    /// Opens the run's task in Atd.
    case open
    /// Writes the answer at the cursor the capture recorded.
    case insert
    /// Puts a reviewed result on the image.
    case apply
  }

  /// A key hint of the footer: Escape stops, closes or discards; ⌥ shows the original text.
  public enum Hint: Equatable, Sendable {
    case stop, close, discard, original
  }

  public let run: String
  public let title: String
  public let scope: CaptureTextScope
  public let notes: [Note]
  public let body: Body
  /// What the version being made shows as it grows (``draftBody(_:of:)``), the pager's newest
  /// page; nil while none is.
  public let draft: Body?
  /// The version shown previews on the image until the person applies it: Apply (⌘↩) puts it
  /// there, and the × and Escape discard it.
  public let reviewing: Bool
  /// The run's versions, once it has them (any output, gated or not); nil before.
  public let versions: Versions?
  public let hints: [Hint]
  public let actions: [Action]
  /// The action with the Run button's fill, which ⌘↩ performs under review.
  public let primary: Action?
  /// The run is still producing: the actions rest until it settles.
  public let busy: Bool
  /// What Copy (and ⌘C) copies; nil when the card has nothing to copy.
  public let copyText: String?
  /// How many paragraphs the run reads when that is fewer than its scope holds (one run reads no
  /// more than ``CaptureTextRun/capacity(of:)`` allows); nil when it reads them all.
  public let covered: Int?

  /// The card for `run` on an image whose annotations are `document`; `canInsert` whether the
  /// capture recorded a cursor an answer can go in at.
  public init(run: CaptureTextRun, document: AnnotationDocument, canInsert: Bool = false) {
    self.run = run.id
    title = run.command
    scope = run.scope
    let content: Content =
      switch run.destination {
      case .card: Self.card(run, canInsert: canInsert)
      case _ where run.awaitsReview: Self.review(run, document: document)
      case .replace: Self.replace(run, document: document)
      case .steps, .marks: Self.marks(run, document: document)
      }
    notes = Self.versionNote(run).map { [$0] } ?? content.notes
    body = content.body
    draft = run.draft.map { Self.draftBody($0, of: run) }
    reviewing = content.reviewing
    actions = content.actions
    primary = content.primary
    busy = content.busy
    copyText = content.copyText
    hints = content.hints
    covered = run.paragraphs.count < run.scope.count ? run.paragraphs.count : nil
    versions = run.review.map { review in
      Versions(
        version: review.version, count: review.count,
        pending: review.pending != nil || run.phase.running, drafting: run.draft != nil,
        adjustments: review.adjustments)
    }
  }

  /// What the note says while the run has versions and another one is being made, or once an
  /// attempt at one failed; nil otherwise, when the card's own note stands.
  private static func versionNote(_ run: CaptureTextRun) -> Note? {
    guard let review = run.review else { return nil }
    if review.pending != nil { return .making(review.count + 1) }
    return run.phase == .failed ? .versionFailed : nil
  }

  /// What one kind of card shows, for ``init(run:document:canInsert:)`` to take.
  struct Content {
    var notes: [Note]
    var body: Body
    var reviewing = false
    var actions: [Action]
    var primary: Action?
    var busy: Bool
    var copyText: String?
    var hints: [Hint]
  }

  private static func card(_ run: CaptureTextRun, canInsert: Bool) -> Content {
    let copied = run.output == .copy && run.copied == (run.review?.version ?? 1)
    let note: Note =
      switch run.shownPhase {
      case .thinking: .reading
      case .streaming: .writing
      case .done: copied ? .copied : .unchanged
      case .stopped: .stopped
      case .failed: .failed
      }
    let insert = run.output == .insertAtCursor && canInsert
    return Content(
      notes: [note],
      body: run.phase == .thinking && run.text.isEmpty ? .skeleton : .answer(run.text),
      actions: [.open, .copy] + (insert ? [.insert] : []), primary: insert ? .insert : .copy,
      busy: run.phase.running, copyText: run.text.isEmpty ? nil : run.text,
      hints: [run.phase.running ? .stop : .close])
  }

  /// A run that replaces paragraphs on the image: each replacement over its original as it lands
  /// (placeholder lines until the first one), and in every version after, Restore and Copy (the
  /// new text) beside Copy Screenshot. Once the replacements are off `document` again, the note
  /// says so and Reapply takes Restore's place. A failure that left a message shows it instead.
  private static func replace(_ run: CaptureTextRun, document: AnnotationDocument) -> Content {
    let (done, total) = run.replaced
    let phase = run.shownPhase
    let restored = !run.phase.running && run.restored(in: document)
    let landed: [Note] = restored ? [.restored] : done > 0 ? [.replaced(done)] : []
    let notes: [Note] =
      switch phase {
      case .thinking, .streaming: [.replacing(done: done, total: total)]
      case .done: landed.isEmpty ? [.nothing] : landed
      case .stopped: [.stopped] + landed
      case .failed: [.failed]
      }
    let rows = replacements(of: run)
    let body: Body =
      phase == .failed && !run.text.isEmpty
      ? .answer(run.text)
      : !rows.isEmpty ? .replacements(rows) : phase == .thinking ? .skeleton : .none
    let copyText = replacedText(rows)
    return Content(
      notes: notes, body: body,
      actions: [restored ? .reapply : .revert] + (copyText == nil ? [] : [.copy]) + [
        .copyScreenshot
      ],
      primary: .copyScreenshot, busy: run.phase.running, copyText: copyText,
      hints: (done > 0 && !restored ? [.original] : []) + [run.phase.running ? .stop : .close])
  }

  /// The run's replacements over the paragraphs they cover, in the answer's order.
  static func replacements(of run: CaptureTextRun) -> [Replacement] {
    run.items.indices.compactMap { index in
      let item = run.items[index]
      guard item.tool == .replace, let paragraph = run[paragraph: item.paragraph] else {
        return nil
      }
      return Replacement(id: index, original: paragraph.text, text: item.text)
    }
  }

  /// The new text as Copy copies it: one paragraph after another, a blank line between.
  static func replacedText(_ rows: [Replacement]) -> String? {
    let text = rows.map(\.text).joined(separator: "\n\n")
    return text.isEmpty ? nil : text
  }
}
