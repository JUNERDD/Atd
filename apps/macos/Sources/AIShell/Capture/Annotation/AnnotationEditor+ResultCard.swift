import AICore
import AppKit
import Observation

/// The text commands' result card in the capture (decisions D1, D5, D8–D10): one at a time,
/// beside the selection and clear of the bars on the display that holds them, on one side of the
/// selection as it grows, kept within the display's visible area (its height too), or where its
/// grabber dragged it; its copied capsule stands where it stood. The editor feeds it the latest
/// run and does what it asks (``CaptureResultAction``).
extension AnnotationEditor {
  /// The card for the run it shows as that run stands, and the preview of the answer under
  /// review.
  func refreshCard() {
    let model = text.card
    if let shown = model.card?.run, let run = text.runs[shown] { model.update(card(for: run)) }
    model.stepColor = interaction.styles[AnnotationTool.step.styleSlot].color
    refreshPreview()
    placeCard()
  }

  /// Puts the card, or the copied capsule it collapsed into, in the bars' host: beside the
  /// selection, on the side it stood on as it grows, cut to the room there when that is short
  /// (``CaptureResultPlacement/capture(size:minimumHeight:selection:bars:workArea:keeping:)``),
  /// unless the grabber moved it; the capsule where the card stood; hidden while nothing shows.
  /// The host enters it from the selection's side, lets it go, and morphs the card into the
  /// capsule (``CaptureResultStage``).
  /// Either sits on whole pixels of its display: unlike a window, which the window server puts on
  /// the pixel grid, a view in the overlay keeps whatever fraction its frame has (a drag's pointer
  /// travel, an edge it was kept inside), and its text and glass are then resampled, which blurs
  /// them on a 1x display.
  func placeCard() {
    let model = text.card
    guard model.presentation != .hidden, let host = toolbar.superview,
      let workArea = workArea(of: host)
    else {
      text.cardHost?.hide()
      return
    }
    let cardHost = text.cardHost ?? makeCardHost()
    if cardHost.superview !== host { host.addSubview(cardHost) }
    model.heightLimit = workArea.height - CaptureResultPlacement.margin * 2
    let size = model.size
    let placed: CGRect
    let face: CaptureResultFace.Kind
    // The side of the selection the card stands on, which it enters from; none once moved.
    var side: CaptureResultPlacement.Side?
    switch model.presentation {
    case .card:
      face = .card
      if let origin = text.cardOrigin {
        placed = CaptureResultPlacement.capsule(
          size: size, at: CGRect(origin: origin, size: size), in: workArea)
      } else {
        let beside = CaptureResultPlacement.capture(
          size: size, minimumHeight: model.minimumHeight, selection: selection, bars: barsFrame,
          workArea: workArea, keeping: text.cardSide)
        text.cardSide = beside.side
        side = beside.side
        placed = beside.frame
      }
    case .copied(let copied):
      face = .copied(copied)
      placed = capsule(size: size, in: workArea)
    case .hidden:
      return
    }
    let frame = host.backingAlignedRect(
      placed,
      options: [.alignMinXNearest, .alignMinYNearest, .alignWidthNearest, .alignHeightNearest])
    if model.presentation == .card { text.cardFrame = frame }
    cardHost.show(face, at: frame, beside: side)
  }

  /// A capsule `size` large where the card stood, at its top-left corner, kept inside `workArea`.
  private func capsule(size: CGSize, in workArea: CGRect) -> CGRect {
    let stood =
      text.cardFrame ?? CGRect(origin: CGPoint(x: selection.maxX, y: selection.minY), size: size)
    return CaptureResultPlacement.capsule(size: size, at: stood, in: workArea)
  }

  /// The toolbar and whichever second row shows, as one block.
  private var barsFrame: CGRect? {
    let shown = ([toolbar, styleBar] + slot.views).filter { $0.superview != nil && !$0.isHidden }
    return shown.isEmpty ? nil : shown.map(\.frame).reduce(CGRect.null) { $0.union($1) }
  }

  /// The visible part of `host`'s display (without the menu bar and the Dock), in its points.
  private func workArea(of host: NSView) -> CGRect? {
    guard let window = host.window, let screen = window.screen else { return nil }
    return host.convert(window.convertFromScreen(screen.visibleFrame), from: nil)
  }

  private func makeCardHost() -> CaptureResultCardHost {
    let host = CaptureResultCardHost(model: text.card)
    text.cardHost = host
    observeCard()
    return host
  }

  /// Places the card again whenever its size or what it presents changes (an answer streaming
  /// in, a copy collapsing it, a close).
  private func observeCard() {
    withObservationTracking {
      _ = text.card.size
      _ = text.card.presentation
    } onChange: { [weak self] in
      Task { @MainActor in
        guard let self, self.text.cardHost != nil else { return }
        self.placeCard()
        self.observeCard()
      }
    }
  }

  // MARK: What the card asks

  func cardAction(_ action: CaptureResultAction) {
    let runner = slot.setup?.textRuns
    switch action {
    case .stop(let id): runner?.act(.stop, runId: id)
    case .discard(let id):
      runner?.act(.close, runId: id)
      forget(id)
    case .perform(let action, let id):
      // Open in Atd and Insert end the capture: nothing is left to refresh.
      guard perform(action, runId: id) else { return }
    case .pick(let item, let id):
      if let box = paragraphBox(of: item, in: id) { flashText([box]) }
    case .version(let version, let id): runner?.act(.version, runId: id, version: version)
    case .regenerate(let id): retry(.regenerate, runId: id)
    case .adjust(let adjust, let id): retry(.adjust, runId: id, adjust: adjust)
    case .move(let travel):
      if text.cardDragStart == nil { text.cardDragStart = text.cardHost?.placed.origin }
      if let start = text.cardDragStart {
        // The copied capsule stands at the card's top-left corner, so it follows the drag too.
        let origin = CGPoint(x: start.x + travel.width, y: start.y + travel.height)
        text.cardOrigin = origin
        text.cardFrame = CGRect(origin: origin, size: text.cardFrame?.size ?? .zero)
      }
      PointerRole.grabbing.cursor.set()
    case .moveEnded: text.cardDragStart = nil
    // The card closed or opened again, or its hovered item changed: the washes follow.
    case .closed, .reopened, .hover: break
    // The long screenshot's summary row's: the capture shows none.
    case .revertAll: break
    }
    refreshTextLayers()
    refreshCard()
  }

  /// A footer action of run `id`'s card; false when it ended the capture.
  private func perform(_ action: CaptureResultCard.Action, runId id: String) -> Bool {
    guard let run = text.runs[id] else { return true }
    let setup = slot.setup
    switch action {
    case .revert:
      store.takeOff(run.annotationIDs)
    case .reapply:
      text.runs.update(id) { $0.reapply(in: store.document) }
      land(id)
    case .copy:
      guard let copied = card(for: run).copyText, setup?.copyText(copied) == true else {
        return true
      }
      text.card.collapse(copied: text.card.labels.copied)
    case .copyScreenshot:
      // What the selection shows now, marks and all, without ending the capture (decision D9).
      guard let shot = renderSelection?(), setup?.copyImage(shot.image, shot.scale) == true else {
        return true
      }
      text.card.collapse(copied: text.card.labels.copiedScreenshot(size: shot.size))
    case .open:
      text.opening = id
      onTextResult?(.open(runId: id))
      return false
    case .insert:
      let answer = run.text.isEmpty ? card(for: run).copyText : run.text
      guard let answer, !answer.isEmpty else { return true }
      onTextResult?(.insert(answer))
      return false
    case .apply:
      text.runs.update(id) { $0.accept() }
      land(id)
    }
    return true
  }
}
