import AICore
import AppKit
import Observation

/// The text commands run from the long screenshot's full-screen preview and what they produce
/// (the plan's 「长截图的全屏预览」): it starts each run on the shell's runner
/// (``CaptureTextRunner``, surface `longScreenshot`), hears its progress
/// (``CaptureTextConsumer``), lands its results on the image through the annotator's store as one
/// undo step per run (``AnnotationStore/land(_:of:context:)``, contract C3.1 §3), so the card keeps
/// them in its annotations whether or not annotate mode ever opened, and drives the result card's
/// content in the lightbox's side panel (``CaptureResultCardModel``, not floating;
/// ``LongScreenshotResultsPanel``) and the marks a run shows on the text. There the card never
/// collapses or closes: its actions report on their own buttons (``feedback``), and what the other
/// runs left on the image stays summed up with its Restore while they left something
/// (``othersChanged``).
///
/// One card at a time (decision D8): a new run replaces the card, and a run still going stops.
/// Once a run has versions, running its command again on the same text makes another version of
/// it, each version that replaces another on the image is an undo step of its own, and undo or
/// redo moves the card to the version the image holds (``followUndo()``). Everything ends with the
/// preview (``release()``): the runner closes every run here.
@Observable
final class LongScreenshotTextResults: CaptureTextConsumer {
  /// The result card's content, which the side panel shows.
  let model = CaptureResultCardModel(dark: true, floating: false)
  /// How the card's actions went, on their own buttons.
  let feedback = IslandShellFeedback<CaptureResultCard.Action>()
  /// Every run started here, oldest first.
  private(set) var runs = CaptureTextRuns()
  /// Runs other than the one the card shows left changes on the image.
  private(set) var othersChanged = false

  @ObservationIgnored let card: IslandLongScreenshotCardModel
  @ObservationIgnored let annotator: LongScreenshotAnnotator
  @ObservationIgnored let text: LongScreenshotTextModel
  @ObservationIgnored let services: LongScreenshotTextServices
  /// The image rows the viewer shows between the bars now.
  @ObservationIgnored var visibleRows: () -> ClosedRange<CGFloat> = { 0...0 }
  /// Shows paragraph box `rect` (image points) in the viewer.
  @ObservationIgnored var reveal: (CGRect) -> Void = { _ in }
  /// Open in Atd: the preview closes (decision D10).
  @ObservationIgnored var onOpen: () -> Void = {}
  /// A run moved on (its progress, a result), which the side panel's toggle marks while hidden.
  @ObservationIgnored var onArrival: () -> Void = {}
  /// A review was discarded: the side panel follows what is left to show, maybe nothing.
  @ObservationIgnored var onForget: () -> Void = {}
  /// A landing is committing: the store's change it announces must not land the same pieces again.
  @ObservationIgnored private var landing = false
  /// The answer under review as the annotator's canvas draws it over the image.
  @ObservationIgnored private let preview = CaptureTextReviewPreview()

  init(
    card: IslandLongScreenshotCardModel, annotator: LongScreenshotAnnotator,
    text: LongScreenshotTextModel, services: LongScreenshotTextServices
  ) {
    self.card = card
    self.annotator = annotator
    self.text = text
    self.services = services
    model.onAction = { [weak self] in self?.handle($0) }
    annotator.onChange = { [weak self] in self?.documentChanged() }
    annotator.store.onRestored = { [weak self] in self?.followUndo() }
  }

  /// The command whose run is reading or writing now, for its button's running bar.
  var runningCommand: String? { runs.running?.commandId }

  // MARK: Running

  /// Runs `command` on the picked paragraphs, or on all available ones: those in view first, then
  /// the rest in reading order (contract: `captureText.run`), as many as one run takes
  /// (``CaptureTextRun/capacity(of:)``), with the values its options menu picked (`arguments`),
  /// else its remembered ones; the files are the kept image as the preview shows it and its
  /// context. A run still going stops, and a review the new card replaces closes. When a run of
  /// the same command and output with versions reads the same paragraphs, it makes another
  /// version of that run instead (``again(_:arguments:)``).
  func run(_ command: SelectionToolbarSettings.Command, arguments: CommandArguments?) {
    guard let runner = services.runner() else { return }
    let paragraphs = runReading
    guard !paragraphs.isEmpty else { return }
    let output =
      arguments?.output ?? services.catalog().entry(for: command.id)?.output.value ?? .card
    if let run = runs.again(command.id, output: output, reading: paragraphs) {
      return again(run, arguments: arguments)
    }
    if let running = runs.running { runner.act(.stop, runId: running.id) }
    let context = annotator.landingContext()
    let run = CaptureTextRun(
      commandId: command.id, command: command.name, scope: text.scope, paragraphs: paragraphs,
      output: output, bounds: context.bounds)
    runs.start(run)
    closeReplacedReviews()
    // The card's step numbers in the colour the badges land in.
    model.stepColor = context.stepStyle.color
    model.show(CaptureResultCard(run: run, document: annotator.store.document))
    refreshCard()
    refreshMarks()
    let kept = card.state.kept
    let files = services.files
    runner.start(
      run, surface: .longScreenshot, commandId: command.id, arguments: arguments,
      consumer: self, files: { await files(kept) })
  }

  /// A retry on run `id`'s card (Regenerate, or an adjustment, `adjust`) reads what a run would
  /// read now: when the person changed the kept range or picked other paragraphs since the run
  /// read its text, the run takes those (``CaptureTextRun/rescope(_:scope:bounds:)``) and the runner
  /// sends them with the kept image as the preview shows it; otherwise, or when nothing is
  /// readable, the version reads what the run read.
  func retry(
    _ action: CaptureTextActionEvent.Action, runId id: String,
    adjust: CaptureTextActionEvent.Adjust? = nil
  ) {
    guard let runner = services.runner() else { return }
    let (reading, scope) = (runReading, text.scope)
    var rescoped = false
    let bounds = annotator.landingContext().bounds
    runs.update(id) { rescoped = $0.rescope(reading, scope: scope, bounds: bounds) != nil }
    guard rescoped, let run = runs[id] else {
      return runner.act(action, runId: id, adjust: adjust)
    }
    let kept = card.state.kept
    let files = services.files
    runner.retry(action, run: run, adjust: adjust, files: { await files(kept) })
  }

  /// What a run reads now: the picked paragraphs, or all available ones, those in view first,
  /// then the rest in reading order, as many as one run takes (``CaptureTextRun/capacity(of:)``).
  private var runReading: [CaptureTextParagraph] {
    let layout = text.layout
    let ordered = order(text.readingOrder)
    return ordered.prefix(CaptureTextRun.capacity(of: ordered.lazy.map { layout[$0].text }))
      .map { layout[$0] }
  }

  /// `reading` (reading order) with the paragraphs in view first.
  private func order(_ reading: [Int]) -> [Int] {
    let rows = visibleRows()
    let inView = reading.filter { index in
      let box = text.layout[index].box
      return box.maxY > rows.lowerBound && box.minY < rows.upperBound
    }
    let shown = Set(inView)
    return inView + reading.filter { !shown.contains($0) }
  }

  func captureTextProgress(_ update: CaptureTextProgressParams, copied: Bool?) {
    guard runs.apply(update, in: annotator.store.document, copied: copied) else { return }
    // A run a newer one replaced can still begin its review (its stopped first version had
    // pieces): nothing could apply it now.
    closeReplacedReviews()
    landPending()
    // The shell copied a `copy` output's answer: its Copy says so.
    if copied == true { feedback.show(.done(model.labels.copied), for: .copy) }
    refreshCard()
    refreshMarks()
    onArrival()
  }

  /// Escape: stops the run in progress (its answer, or the version it is making); false with
  /// none.
  func stopRunning() -> Bool {
    guard let running = runs.running else { return false }
    services.runner()?.act(.stop, runId: running.id)
    return true
  }

  /// Closes every review another run's card replaced: the newest run's, or run `shown`'s
  /// (``CaptureTextRuns/dropReplacedReviews(keeping:)``).
  func closeReplacedReviews(keeping shown: String? = nil) {
    for id in runs.dropReplacedReviews(keeping: shown) {
      services.runner()?.act(.close, runId: id)
    }
  }

  /// An undo or a redo finished: each run with versions follows the version the image holds now,
  /// and the card shows it (`version`) without landing it again (``CaptureTextRuns/follow(_:)``).
  private func followUndo() {
    let before = runs
    let shown = runs.follow(annotator.store.document)
    guard runs != before else { return }
    for (run, version) in shown { services.runner()?.act(.version, runId: run, version: version) }
    refreshCard()
    refreshMarks()
  }

  // MARK: Landing

  /// Lands what every run has waiting, unless a gesture is drawing, moving or resizing, text is
  /// open, or ⌥ shows the original: the annotator's next change lands it then
  /// (``documentChanged()``).
  func landPending() {
    guard !landing, annotator.canLand, runs.runs.contains(where: \.needsLanding) else { return }
    landing = true
    defer { landing = false }
    let context = annotator.landingContext()
    var landed: Set<Int> = []
    for run in runs.runs where run.needsLanding {
      guard annotator.store.land(run.id, of: runs, context: context, record: { runs = $0 }) else {
        continue
      }
      for item in run.unapplied {
        if let id = run.items[item].paragraph, let paragraph = run[paragraph: id],
          let index = text.layout.index(of: paragraph)
        {
          landed.insert(index)
        }
      }
    }
    text.land(landed)
  }

  /// The image changed (a landing, an edit, undo, Restore): what waited lands, and the card and
  /// the summary row count what is still on the image.
  private func documentChanged() {
    guard !landing else { return }
    landPending()
    refreshCard()
  }

  /// The card follows the run it shows, the summary sums up the image, the items in view follow,
  /// and the answer under review previews on it.
  func refreshCard() {
    let document = annotator.store.document
    let shown = model.card?.run
    if let shown, let run = runs[shown] {
      model.update(CaptureResultCard(run: run, document: document))
    }
    model.setDock(runs.summary(in: document))
    let present = Set(document.annotations.map(\.id))
    let others = runs.runs.contains {
      $0.id != shown && !$0.annotationIDs.isDisjoint(with: present)
    }
    if othersChanged != others { othersChanged = others }
    refreshInView()
    refreshPreview()
  }

  /// The card's rows (items, replacements) whose paragraph shows between the bars now are marked in
  /// view.
  func refreshInView() {
    guard let card = model.card else { return }
    let rows = visibleRows()
    let listed: [Int] =
      switch card.body {
      case .items(_, let entries): entries.map(\.id)
      case .replacements(let replacements): replacements.map(\.id)
      case .none, .skeleton, .answer: []
      }
    let inView = Set(
      listed.filter { item in
        guard
          let box = paragraph(of: item, in: card.run).map({ text.layout[$0].box })
            ?? appliedBox(of: item, in: card.run)
        else { return false }
        return box.maxY > rows.lowerBound && box.minY < rows.upperBound
      })
    if model.inView != inView { model.inView = inView }
  }

  /// The answer under review previews dashed on the annotator's canvas, as it would land now.
  private func refreshPreview() {
    annotator.drawing.reviewPreview = preview.update(
      runs, over: annotator.store.document, context: annotator.landingContext())
  }

  /// The running run's paragraphs that have no result yet shimmer; while it makes another version
  /// the one shown stays, without a shimmer.
  func refreshMarks() {
    guard let running = runs.running, !running.remaking else { return text.setReading([]) }
    let done = Set(running.items.compactMap(\.paragraph))
    text.setReading(
      Set(
        running.paragraphs.filter { !done.contains($0.id) }.compactMap {
          text.layout.index(of: $0.paragraph)
        }))
  }

  /// The preview closes: every run here is closed and nothing previews on the image any more; the
  /// side panel keeps the last card while the chrome fades out with the lightbox.
  func release() {
    services.runner()?.release(self)
    text.setReading([])
    annotator.drawing.reviewPreview = nil
  }

  /// The layout index of item `item` of run `runId`, if it is about a paragraph the run read.
  func paragraph(of item: Int, in runId: String) -> Int? {
    guard let run = runs[runId], run.items.indices.contains(item),
      let id = run.items[item].paragraph, let paragraph = run[paragraph: id]
    else { return nil }
    return text.layout.index(of: paragraph)
  }

  /// The replacements every run put on the image, and those a review previews, which ⌥ hides to
  /// show the original.
  var replacementIDs: Set<UUID> {
    var ids = preview.preview?.replacements ?? []
    for run in runs.runs {
      for (item, drawn) in run.applied
      where run.items.indices.contains(item) && run.items[item].tool == .replace {
        ids.formUnion(drawn)
      }
    }
    return ids
  }

  /// The run and item whose step badge on the image is annotation `id`, if a run put it there.
  func item(drawing id: UUID) -> (run: String, item: Int)? {
    for run in runs.runs {
      if let (item, _) = run.applied.first(where: { $0.value.contains(id) }) {
        return (run.id, item)
      }
    }
    return nil
  }

  /// Forgets run `id` after its review was discarded: the panel shows the latest run left, or
  /// nothing.
  func forget(_ id: String) {
    runs.remove(id)
    if let latest = runs.latest {
      model.show(CaptureResultCard(run: latest, document: annotator.store.document))
    } else {
      model.reset()
    }
    refreshCard()
    refreshMarks()
    onForget()
  }

  /// Applies a reviewed answer: it lands now.
  func accept(_ id: String) {
    runs.update(id) { $0.accept() }
    landPending()
    refreshCard()
  }

  /// Puts back the result of run `id` that Restore took off the image (its card's Reapply).
  func reapply(_ id: String) {
    runs.update(id) { $0.reapply(in: annotator.store.document) }
    landPending()
    refreshCard()
  }
}
