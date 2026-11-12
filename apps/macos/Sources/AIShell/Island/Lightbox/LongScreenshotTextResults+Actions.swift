import AICore
import AppKit

/// What the result card asks for in the full-screen preview (``CaptureResultAction``): every
/// action the side panel offers, done on the runner, the annotator's store, the clipboard or the
/// viewer.
extension LongScreenshotTextResults {
  func handle(_ action: CaptureResultAction) {
    let runner = services.runner()
    switch action {
    case .stop(let id):
      runner?.act(.stop, runId: id)
    case .closed, .reopened, .move, .moveEnded:
      // The floating card's own (its ×, a click on its result reopening it, its grabber): the
      // side panel has none.
      break
    case .discard(let id):
      runner?.act(.close, runId: id)
      forget(id)
    case .perform(let performed, let id):
      perform(performed, runId: id)
    case .revertAll:
      annotator.store.takeOff(runs.annotationIDs(in: annotator.store.document))
    case .hover(let item, let id):
      text.hover(item.flatMap { paragraph(of: $0, in: id) })
    case .pick(let item, let id):
      guard let index = paragraph(of: item, in: id) else { return }
      reveal(text.layout[index].box)
      text.land([index])
    case .version(let version, let id):
      runner?.act(.version, runId: id, version: version)
    case .regenerate(let id):
      retry(.regenerate, runId: id)
    case .adjust(let adjust, let id):
      retry(.adjust, runId: id, adjust: adjust)
    }
  }

  private func perform(_ action: CaptureResultCard.Action, runId id: String) {
    switch action {
    case .revert:
      guard let run = runs[id] else { return }
      annotator.store.takeOff(run.annotationIDs)
    case .reapply:
      reapply(id)
    case .copy:
      guard let copy = model.card?.copyText, services.copyText(copy) else { return NSSound.beep() }
      feedback.show(.done(model.labels.copied), for: .copy)
    case .copyScreenshot:
      copySegment(of: id)
    case .open:
      // Decision D10: the panel shows the run's task, and the preview closes.
      services.runner()?.act(.open, runId: id)
      onOpen()
    case .apply:
      accept(id)
    case .insert:
      // The preview records no cursor, so its cards never offer Insert.
      break
    }
  }

  /// Copy Screenshot (decision D9): the stretch of the kept range that holds what run `id`
  /// changed, as the preview shows it (``LongScreenshotExportRules/segment(holding:of:)``); its
  /// button then says its size.
  private func copySegment(of id: String) {
    guard let run = runs[id] else { return }
    let document = annotator.store.document
    let areas = run.annotationIDs.compactMap { document[$0]?.bounds }
    let segment = LongScreenshotExportRules.segment(holding: areas, of: card.state.kept)
    let copyImage = services.copyImage
    Task { [weak self] in
      let size = await copyImage(segment)
      guard let self else { return }
      guard let size else { return NSSound.beep() }
      feedback.show(.done(model.labels.copiedScreenshot(size: size)), for: .copyScreenshot)
    }
  }

  /// A click on the image at `point` (image points) that hit a step badge a run drew: the card
  /// opens on its run with the item lit. False when no run's badge is there.
  func openBadge(at point: CGPoint) -> Bool {
    guard let (run, item) = badge(at: point) else { return false }
    openCard(of: run, lighting: item)
    return true
  }

  /// A plain click in text mode at `point` (image points), which picks the paragraph under it:
  /// when it is on the result of a run with versions (a paragraph it covers, one of its marks),
  /// that run's card opens too, while nothing is producing (``CaptureTextRuns/reopening(at:in:)``).
  /// False when no card opened.
  func reopen(at point: CGPoint) -> Bool {
    guard let run = runs.reopening(at: point, in: annotator.store.document) else { return false }
    openCard(of: run.id)
    return true
  }

  /// Whether a click at `point` (image points) in text mode opens a card: on a run's step badge,
  /// or on a highlighter mark of a run with versions; the pointer then shows that it acts.
  func opensCard(at point: CGPoint) -> Bool {
    badge(at: point) != nil || runs.mark(at: point, in: annotator.store.document) != nil
  }

  /// Run `run`'s command ran again on the text it reads: its card shows, and the page makes
  /// another version with `arguments` (the values the options menu picked; nil when none), unless
  /// the run has as many versions as it may make. Another run still going stops, and a review
  /// whose card this one replaces closes.
  func again(_ run: CaptureTextRun, arguments: CommandArguments?) {
    guard let runner = services.runner() else { return }
    if let running = runs.running, running.id != run.id { runner.act(.stop, runId: running.id) }
    closeReplacedReviews(keeping: run.id)
    openCard(of: run.id)
    guard let versions = run.review, versions.count < CommandProgressState.Review.maxVersions
    else { return NSSound.beep() }
    runner.act(.again, runId: run.id, arguments: arguments)
  }

  /// Opens run `id`'s card with item `item` lit: the card shown opens again, or another run's
  /// replaces it (decision D8, one card at a time).
  private func openCard(of id: String, lighting item: Int? = nil) {
    guard let run = runs[id] else { return }
    model.reopen(CaptureResultCard(run: run, document: annotator.store.document), lighting: item)
    refreshCard()
    refreshMarks()
  }

  /// The run and item whose step badge on the image is under `point` (image points), front-most.
  private func badge(at point: CGPoint) -> (run: String, item: Int)? {
    let document = annotator.store.document
    let ids = runs.annotationIDs(in: document)
    guard
      let badge = document.annotations.last(where: { annotation in
        guard ids.contains(annotation.id), case .step = annotation.shape else { return false }
        return annotation.bounds.insetBy(dx: -2, dy: -2).contains(point)
      })
    else { return nil }
    return item(drawing: badge.id)
  }
}
