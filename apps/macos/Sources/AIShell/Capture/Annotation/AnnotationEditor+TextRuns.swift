import AICore
import AppKit

/// Text commands run on the selection's text while the capture stays open (`captureText.run`,
/// decisions D2, D8): a run reads what text mode selects, its answer lands on the image as
/// ordinary annotations (each run one undo step, each version that replaces another one more,
/// ``AnnotationStore/land(_:of:context:)``) or stays on the result card, and the runner routes
/// its updates here (``CaptureTextConsumer``). Once a run has versions, running its command again
/// on the same text makes another version of it, and undo or redo moves its card to the version
/// the image holds. Nothing lands while a stroke, a move or a resize is being drawn or text is
/// open, since a commit would end it; what waited lands once it ends.
extension AnnotationEditor: CaptureTextConsumer {
  /// Runs `launch` (a command of the text row, with the values its menu picked) on what text mode
  /// reads now, as much of it as one run takes; a run still producing stops first, so one runs at
  /// a time, and a review its card replaces closes (``closeReplacedReviews(keeping:)``). When a
  /// run of the same command and output with versions reads the same paragraphs, it makes
  /// another version of that run instead (``again(_:arguments:)``).
  func runText(_ launch: CommandLaunch) {
    guard let setup = slot.setup, let runner = setup.textRuns else { return NSSound.beep() }
    let mode = text.mode
    let paragraphs = mode.runReading.map { mode.layout[$0] }
    guard !paragraphs.isEmpty else { return NSSound.beep() }
    let output =
      launch.arguments?.output ?? setup.catalog.entry(for: launch.id)?.output.value ?? .card
    if let run = text.runs.again(launch.id, output: output, reading: paragraphs) {
      return again(run, arguments: launch.arguments)
    }
    if let running = text.runs.running { runner.act(.stop, runId: running.id) }
    let name =
      (setup.textCommands + setup.commands).first { $0.id == launch.id }?.name
      ?? setup.catalog.entry(for: launch.id)?.name ?? launch.id
    let run = CaptureTextRun(
      commandId: launch.id, command: name, scope: mode.scope, paragraphs: paragraphs,
      output: output, bounds: selection)
    text.runs.start(run)
    closeReplacedReviews()
    text.cardOrigin = nil
    text.cardSide = nil
    text.card.insertApp = setup.cursorApp
    text.card.show(card(for: run))
    runner.start(
      run, surface: .capture, commandId: launch.id, arguments: launch.arguments, consumer: self,
      files: runFiles())
    refresh()
  }

  /// Runs a free-form `question` asked from `AnnotationAskBar` on either the screenshot or picked
  /// text, honoring `output` ("When done"). `panel` starts the task and immediately hands it over
  /// to the Atd panel as capture ends; every other output runs in place on the open capture.
  func runTextAsk(_ question: String, output: CommandOutputAction) {
    guard let setup = slot.setup, let runner = setup.textRuns else { return NSSound.beep() }
    let mode = text.mode
    let paragraphs = mode.runReading.map { mode.layout[$0] }
    let scope =
      mode.isOn && !paragraphs.isEmpty
      ? mode.scope : CaptureTextScope(kind: .screenshot, count: mode.reading.count)
    slot.finishAsk()
    if let running = text.runs.running { runner.act(.stop, runId: running.id) }
    let run = CaptureTextRun(
      commandId: CaptureTextRun.askID, command: ShellStrings.shared.text(.selectionToolbarAsk),
      scope: scope, paragraphs: paragraphs, output: output, bounds: selection)
    let arguments = CommandArguments(output: output, choices: [:], toggles: [:])
    let files = runFiles()
    if output == .panel {
      runner.start(
        run, surface: .capture, question: question, arguments: arguments, consumer: self,
        files: files)
      text.opening = run.id
      onTextResult?(.open(runId: run.id))
      return
    }
    text.runs.start(run)
    closeReplacedReviews()
    text.cardOrigin = nil
    text.cardSide = nil
    text.card.insertApp = setup.cursorApp
    text.card.show(card(for: run))
    runner.start(
      run, surface: .capture, question: question, arguments: arguments, consumer: self,
      files: files)
    refresh()
    focusCanvas()
  }

  /// A retry on run `id`'s card (Regenerate, or an adjustment, `adjust`) reads what text mode
  /// reads now: when the person moved or resized the selection or picked other paragraphs since
  /// the run read its text, the run takes what the selection holds now
  /// (``CaptureTextRun/rescope(_:scope:bounds:)``) and the runner sends it with the selection as
  /// it shows now; otherwise the version reads what the run read.
  func retry(
    _ action: CaptureTextActionEvent.Action, runId id: String,
    adjust: CaptureTextActionEvent.Adjust? = nil
  ) {
    guard let runner = slot.setup?.textRuns else { return }
    let mode = text.mode
    let reading = mode.runReading.map { mode.layout[$0] }
    let scope =
      mode.isOn && !reading.isEmpty
      ? mode.scope : CaptureTextScope(kind: .screenshot, count: mode.reading.count)
    var rescoped = false
    text.runs.update(id) {
      rescoped = $0.rescope(reading, scope: scope, bounds: selection) != nil
    }
    guard rescoped, let run = text.runs[id] else {
      return runner.act(action, runId: id, adjust: adjust)
    }
    runner.retry(action, run: run, adjust: adjust, files: runFiles())
  }

  /// The files a run reads beside its text, written when the runner asks: the selection as it
  /// shows now and its screen context.
  private func runFiles() -> () async -> CaptureTextRunner.Files? {
    let shot = renderSelection?()
    let context = ScreenContext(
      app: shot?.app, window: shot?.window, element: nil, recognized: recognizedText?.boxes ?? [],
      hiding: mosaics
    ).markdown
    return { await Self.files(shot, context: context, capturedAt: Date()) }
  }

  /// Run `run`'s command ran again on the text it reads: its card shows, and the page makes
  /// another version with `arguments` (the values the options menu picked; nil when none), unless
  /// the run has as many versions as it may make. Another run still producing stops, and a review
  /// whose card this one replaces closes.
  private func again(_ run: CaptureTextRun, arguments: CommandArguments?) {
    guard let runner = slot.setup?.textRuns else { return }
    if let running = text.runs.running, running.id != run.id {
      runner.act(.stop, runId: running.id)
    }
    closeReplacedReviews(keeping: run.id)
    openCard(of: run.id)
    guard let versions = run.review,
      versions.count < CommandProgressState.Review.maxVersions
    else {
      if arguments == nil, run.restored(in: store.document) {
        text.runs.update(run.id) { $0.reapply(in: store.document) }
        land(run.id)
        refresh()
        return
      }
      return NSSound.beep()
    }
    runner.act(.again, runId: run.id, arguments: arguments)
    refresh()
  }

  func captureTextProgress(_ update: CaptureTextProgressParams, copied: Bool?) {
    guard text.runs.apply(update, in: store.document, copied: copied) else { return }
    // A run a newer one replaced can still begin its review (its stopped first version had
    // pieces): nothing could apply it now.
    closeReplacedReviews()
    land(update.runId)
    if copied == true { text.card.collapse(copied: text.card.labels.copied) }
    refresh()
  }

  /// Lands what run `id` has waiting, now or (during a gesture or open text) once it ends.
  func land(_ id: String) {
    guard !interaction.isGesturing, !textEditor.isEditing else {
      text.waiting.insert(id)
      return
    }
    text.waiting.remove(id)
    let before = Set(text.runs[id].map { Array($0.applied.keys) } ?? [])
    // The session's runs record the landing before the commit's change refreshes the editor,
    // which reads them.
    let landed = store.land(id, of: text.runs, context: markContext) { text.runs = $0 }
    guard landed, let run = text.runs[id] else { return }
    // The paragraphs or marks a result just covered flash once.
    flashText(
      run.applied.keys.filter { !before.contains($0) }.sorted().compactMap { item in
        paragraphBox(of: item, in: id)
      })
  }

  /// A gesture or the open text ended: what waited lands.
  func landWaiting() {
    guard !text.waiting.isEmpty, !interaction.isGesturing, !textEditor.isEditing else { return }
    for id in text.waiting { land(id) }
    refresh()
  }

  /// Closes every review another run's card replaced: the newest run's, or run `shown`'s
  /// (``CaptureTextRuns/dropReplacedReviews(keeping:)``).
  private func closeReplacedReviews(keeping shown: String? = nil) {
    for id in text.runs.dropReplacedReviews(keeping: shown) {
      slot.setup?.textRuns?.act(.close, runId: id)
      text.waiting.remove(id)
    }
  }

  /// An undo or a redo finished: each run with versions follows the version the image holds now,
  /// and the card shows it (`version`) without landing it again (``CaptureTextRuns/follow(_:)``).
  func followUndo() {
    let before = text.runs
    let shown = text.runs.follow(store.document)
    guard text.runs != before else { return }
    for (run, version) in shown {
      slot.setup?.textRuns?.act(.version, runId: run, version: version)
    }
    refresh()
  }

  /// Forgets run `id` once its review was discarded and the page let it go, so nothing can open
  /// its card, and its Apply, again; the card it showed already went
  /// (``CaptureResultCardModel/discard()``), keeping what it showed while it leaves.
  func forget(_ id: String) {
    text.runs.remove(id)
    text.waiting.remove(id)
    syncResultToggle()
  }

  /// The answer under review previews dashed on every canvas, as it would land now; ⌥ keeps
  /// hiding its replacements while it changes.
  func refreshPreview() {
    let preview = text.preview.update(text.runs, over: store.document, context: markContext)
    for canvas in canvases { canvas.reviewPreview = preview }
    if text.showsOriginals { refreshOriginals() }
  }

  /// The surface ended: the runner closes its runs, but keeps the one Open in Atd hands to the
  /// panel; nothing of them is kept here.
  func releaseText() {
    slot.setup?.textRuns?.release(self, keeping: text.opening)
    for canvas in canvases { canvas.textLayer.stop() }
    text.reset()
    syncResultToggle()
  }

  /// The card for `run` as it stands, on the image as it is now.
  func card(for run: CaptureTextRun) -> CaptureResultCard {
    let canInsert = slot.setup.map { $0.cursor && $0.cursorApp != nil } ?? false
    return CaptureResultCard(run: run, document: store.document, canInsert: canInsert)
  }

  // MARK: Drawing the answer

  /// What the marks need from the editor: the remembered step and highlighter styles, the
  /// selection as the bounds, the colours under each paragraph in the frozen pixels, and the
  /// renderer's text measure.
  var markContext: CaptureTextMarks.Context {
    let backdrop = backdrop
    return CaptureTextMarks.Context(
      stepStyle: interaction.styles[AnnotationTool.step.styleSlot],
      highlightStyle: interaction.styles[AnnotationTool.highlighter.styleSlot],
      bounds: selection,
      colors: { paragraph in
        guard let backdrop else { return CaptureTextColors.fallback }
        let box = paragraph.box.offsetBy(dx: -backdrop.origin.x, dy: -backdrop.origin.y)
        let region = CGRect(
          x: box.minX * backdrop.scale, y: box.minY * backdrop.scale,
          width: box.width * backdrop.scale, height: box.height * backdrop.scale)
        return CaptureTextColors.sample(backdrop.image, region: region) ?? .fallback
      },
      measure: { AnnotationRenderer.measure($0, fontSize: $1, width: $2) })
  }

  // MARK: The files a run attaches

  /// Writes the selection as it shows and its screen context (`context`, the Markdown the import
  /// path builds, from the text no mosaic touches) into a folder of their own; nil when the image
  /// could not be written. The runner deletes the folder once their import answered.
  private static func files(_ shot: CaptureSelectionShot?, context: String?, capturedAt: Date)
    async -> CaptureTextRunner.Files?
  {
    guard let shot else { return nil }
    let folder = URL.temporaryDirectory.appending(path: "screenshot-text-\(UUID().uuidString)")
    let remove = { _ = try? FileManager.default.removeItem(at: folder) }
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      var urls = [try await CaptureExport.store(shot.image, capturedAt: capturedAt, in: folder)]
      if let context,
        let file = await CaptureLibrary.write(
          context,
          to: folder.appending(path: ScreenshotRules.contextFileName(capturedAt: capturedAt)))
      {
        urls.append(file)
      }
      return CaptureTextRunner.Files(urls: urls, delete: remove)
    } catch {
      remove()
      return nil
    }
  }
}
