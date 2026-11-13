import AICore
import AppKit
import Observation

/// The long screenshot's result card as it runs (decision D11): its state
/// (``LongScreenshotCardState``: the kept range and what is on the image) with what the card's
/// views add (the page under the pointer, the handle the arrow keys move, the preview's images,
/// Cover Sensitive Info's confirmation), its asking (``asking``) and its footer's feedback. The card's views and its lightbox
/// (whose annotate mode writes the annotations, ``setAnnotations(_:)``) call it, it applies local
/// changes and requests external work through ``onEvent``; the presenter
/// (``IslandLongScreenshot``) re-measures the card when its size changes (``onResize``).
@Observable
final class IslandLongScreenshotCardModel {
  private(set) var state: LongScreenshotCardState
  /// The state's source, which never changes: reading it here does not follow the kept range.
  let source: LongScreenshotCardSource
  /// The pages Atd reads the kept range as, worked out again when the range or a mosaic changes.
  private(set) var pages: [LongScreenshotCardPage] = []
  /// The page whose row or part of the preview has the pointer: the two are marked together.
  private(set) var hoveredPage: Int?
  /// The handle the arrow keys nudge: the one pressed or dragged last.
  var focusedHandle: LongScreenshotCardState.Edge?
  /// The whole image as the preview and the lightbox's overview draw it, made off the main
  /// actor; nil until it is.
  private(set) var thumbnail: CGImage?
  /// The thumbnail with the annotations drawn in, made off the main actor after each change
  /// (``drawAnnotations()``); it may lag the latest change until the next one lands.
  private(set) var annotatedThumbnail: CGImage?
  /// Card-sized preview bitmap matching ``IslandMetrics/longScreenshotPreviewBox`` at backing
  /// scale so the card preview never downsamples the larger lightbox overview bitmap on the fly.
  private(set) var cardThumbnail: CGImage?
  private(set) var annotatedCardThumbnail: CGImage?
  /// How many sensitive items Cover Sensitive Info just covered, which its button says in place
  /// of its label for ``CommandProgressState/doneDuration`` (decision D7); nil otherwise.
  private(set) var redacted: Int?
  /// Asking about the kept range.
  let asking = IslandAsking<LongScreenshotAsk, LongScreenshotQuickAsk>()
  /// What Annotate, Copy and Attach report on their buttons
  /// (``IslandLongScreenshot/cardFeedback(_:_:)``).
  let feedback = IslandShellFeedback<IslandLongScreenshot.CardAction>()
  /// The measured stack's bounded preview and answer regions.
  private(set) var layout: IslandMetrics.ShellCardLayout?
  /// The first measurement is the animation origin; mounting never lays out from zero.
  private(set) var layoutOrigin: IslandMetrics.ShellCardLayout?

  /// One of the card's buttons has the keyboard focus (Full Keyboard Access), so the arrows
  /// stay with it rather than nudging a handle (``IslandControlFocus``).
  @ObservationIgnored var controlFocused = false
  @ObservationIgnored var onEvent: (LongScreenshotCardEvent) -> Void = { _ in }
  /// Opens the card's lightbox (set by its presenter): at `y` (image points) about a third down
  /// the view, or at the top; in annotate mode when `annotate`.
  @ObservationIgnored var openLightbox: (_ y: CGFloat?, _ annotate: Bool) -> Void = { _, _ in }
  /// The preview image's frame in the island window's content (SwiftUI's global space there),
  /// where the lightbox grows from and goes back to; nil before the preview is laid out.
  @ObservationIgnored var mediaFrame: CGRect?
  /// The card's size may have changed.
  @ObservationIgnored var onResize: () -> Void = {}
  /// The kept range when a handle was pressed, which its drag moves from; nil between drags.
  @ObservationIgnored private var dragStart: LongScreenshotKept?
  @ObservationIgnored private var thumbnailTask: Task<Void, Never>?
  /// The annotations being drawn into the preview's image, and whether they changed meanwhile.
  @ObservationIgnored private var annotating: Task<Void, Never>?
  @ObservationIgnored private var annotationsChanged = false
  @ObservationIgnored private var redactedReset: Task<Void, Never>?

  init(_ state: LongScreenshotCardState) {
    self.state = state
    source = state.source
    pages = state.pages
    asking.range = { [weak self] in self?.state.kept }
    asking.onResize = { [weak self] in self?.onResize() }
    asking.onEvent = { [weak self] event in
      switch event {
      case .ask(let ask): self?.onEvent(.ask(ask))
      case .stop(let id): self?.onEvent(.stopAnswer(id))
      case .regenerate(let ask): self?.onEvent(.regenerate(ask))
      case .open(let id): self?.onEvent(.openAnswer(id))
      }
    }
    makeThumbnail()
  }

  func setLayout(_ layout: IslandMetrics.ShellCardLayout) {
    if layoutOrigin == nil { layoutOrigin = layout }
    self.layout = layout
  }

  /// The card shows (again): its answer slot as short as its answer, nothing hovered.
  func reopen() {
    asking.answerFloor = 0
    layout = nil
    hoveredPage = nil
    controlFocused = false
  }

  // MARK: Trim and Cover Sensitive Info

  /// Handle `edge` dragged `offset` image points from where it was when pressed, so a press
  /// alone moves nothing wherever on the handle it lands.
  func drag(_ edge: LongScreenshotCardState.Edge, by offset: CGFloat) {
    if focusedHandle != edge { focusedHandle = edge }
    let start = dragStart ?? state.kept
    dragStart = start
    state.setTrim(edge, to: (edge == .top ? start.top : start.bottom) + offset)
    keptChanged()
  }

  /// The handle was let go.
  func endDrag() { dragStart = nil }

  /// The focused handle moved by an arrow key (``LongScreenshotCardState/nudge(shift:)``), down
  /// the image when `down`; false with no handle focused.
  func nudge(down: Bool, shift: Bool) -> Bool {
    guard let edge = focusedHandle else { return false }
    let step = LongScreenshotCardState.nudge(shift: shift)
    state.nudge(edge, by: down ? step : -step)
    keptChanged()
    return true
  }

  /// "还原": the whole image is kept again with nothing on it: no drawing, no mosaic, no text
  /// command result (decision D5).
  func restore() {
    state.restore()
    keptChanged()
    drawAnnotations()
  }

  /// Cover Sensitive Info on the card (decision D7): a mosaic over each sensitive item in the
  /// kept range that none hides yet, in the mosaic tool's remembered style, as ordinary
  /// annotations the lightbox's annotate mode can move or delete; then its button confirms. The
  /// lightbox covers through its annotator instead, so the mosaics are one undo step there.
  func redact() {
    let hits = state.unmaskedSensitive
    guard !hits.isEmpty else { return }
    setAnnotations(state.annotations.redacting(hits, style: Self.mosaicStyle()))
    confirmRedaction(hits.count)
  }

  /// The mosaic tool's style as the screenshot editor remembers it: what Cover Sensitive Info
  /// draws with wherever it is pressed outside the mosaic tool's own style bar.
  static func mosaicStyle(_ defaults: UserDefaults = .standard) -> AnnotationStyle {
    AnnotationStyleMemory.load(from: defaults)[AnnotationTool.mosaic.styleSlot]
  }

  /// Cover Sensitive Info's buttons say `count` items were covered for a moment.
  func confirmRedaction(_ count: Int) {
    redacted = count
    redactedReset?.cancel()
    redactedReset = Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard !Task.isCancelled else { return }
      self?.redacted = nil
    }
  }

  /// What is drawn on the image (image points, origin top-left), as the lightbox's annotate mode
  /// changes it: the card keeps it at once, with no step to confirm it, so the pages and the
  /// lines Atd reads follow (a mosaic hides the lines it touches), the preview and the overview
  /// draw it in, and every action and ask sends it.
  func setAnnotations(_ document: AnnotationDocument) {
    guard document != state.annotations else { return }
    state.setAnnotations(document)
    keptChanged()
    drawAnnotations()
  }

  /// The pointer entered (`inside`) or left page `index`'s row or part of the preview. Leaving
  /// one page after entering the next keeps the next one's.
  func hover(page index: Int, _ inside: Bool) {
    if inside {
      if hoveredPage != index { hoveredPage = index }
    } else if hoveredPage == index {
      hoveredPage = nil
    }
  }

  /// The page at `y` (image points) on the preview has the pointer; nil once it left.
  func hoverPreview(at y: CGFloat?) {
    let index = y.flatMap { y in pages.firstIndex { y >= $0.top && y < $0.bottom } }
    if hoveredPage != index { hoveredPage = index }
  }

  private func keptChanged() {
    pages = state.pages
    if let hovered = hoveredPage, !pages.indices.contains(hovered) { hoveredPage = nil }
  }

  // MARK: The preview's images

  /// The image the preview, the lightbox's overview and its motion draw now: the thumbnail with
  /// the annotations drawn in once that is made.
  var displayThumbnail: CGImage? {
    state.annotations.isEmpty ? thumbnail : annotatedThumbnail ?? thumbnail
  }

  /// The 1:1 card-preview bitmap, falling back to ``displayThumbnail`` until ready.
  var cardDisplayThumbnail: CGImage? {
    state.annotations.isEmpty
      ? (cardThumbnail ?? thumbnail)
      : (annotatedCardThumbnail ?? cardThumbnail ?? displayThumbnail)
  }

  /// The widest the thumbnail is drawn, in points: the lightbox's overview rail (120 pt) at twice
  /// its width, wider than the card's preview box (``IslandMetrics/longScreenshotPreviewBox``).
  private static let thumbnailWidth = 240.0

  /// The thumbnail sharp wherever it is drawn: in the card's preview and down the lightbox's
  /// overview rail, as tall as a screen's work area. The image is fitted into
  /// ``thumbnailWidth`` × the tallest work area points at the largest backing scale of any screen.
  private func makeThumbnail() {
    let image = source.shot.image
    let screens = NSScreen.screens
    let tallest =
      screens.map { Double($0.visibleFrame.height) }.max()
      ?? IslandMetrics.longScreenshotPreviewBox.height
    let fitted = IslandMetrics.longScreenshotImage(
      source.shot.pointSize, in: WindowSize(width: Self.thumbnailWidth, height: tallest))
    let cardFitted = IslandMetrics.longScreenshotImage(
      source.shot.pointSize, in: IslandMetrics.longScreenshotPreviewBox)
    let scale = screens.map(\.backingScaleFactor).max() ?? 2
    let width = Int((fitted.width * scale).rounded())
    let height = Int((fitted.height * scale).rounded())
    let cardWidth = Int((cardFitted.width * scale).rounded())
    let cardHeight = Int((cardFitted.height * scale).rounded())
    thumbnailTask = Task { [weak self] in
      async let made = IslandLongScreenshotThumbnail.make(image, width: width, height: height)
      async let madeCard = IslandLongScreenshotThumbnail.make(
        image, width: cardWidth, height: cardHeight)
      let (full, card) = await (made, madeCard)
      guard let self, !Task.isCancelled else { return }
      thumbnail = full
      cardThumbnail = card
      drawAnnotations()
    }
  }

  /// Draws the annotations into the preview's image again, off the main actor: one drawing at a
  /// time, and once it lands another for whatever changed meanwhile, so a burst of changes (a
  /// stroke after a stroke, undo pressed in a row, a translation streaming in) ends with the latest.
  /// Without annotations, or before the image is made, there is nothing to draw.
  private func drawAnnotations() {
    guard annotating == nil else {
      annotationsChanged = true
      return
    }
    annotationsChanged = false
    let annotations = state.annotations
    guard !annotations.isEmpty, let base = thumbnail else {
      annotatedThumbnail = nil
      annotatedCardThumbnail = nil
      return
    }
    let cardBase = cardThumbnail
    let shot = source.shot
    annotating = Task { [weak self] in
      async let fullTask = IslandLongScreenshotThumbnail.annotated(
        base, shot: shot, annotations: annotations)
      async let cardTask: CGImage? =
        if let cardBase {
          await IslandLongScreenshotThumbnail.annotated(
            cardBase, shot: shot, annotations: annotations)
        } else {
          nil
        }
      let (made, madeCard) = await (fullTask, cardTask)
      guard let self, !Task.isCancelled else { return }
      annotating = nil
      annotatedThumbnail = made
      annotatedCardThumbnail = madeCard
      if annotationsChanged { drawAnnotations() }
    }
  }

  /// The card went for good: its images are no longer made.
  func close() {
    thumbnailTask?.cancel()
    annotating?.cancel()
    redactedReset?.cancel()
  }
}

/// A layer keeps the card it shows (``IslandLayer/shellCard``): one card is one model.
extension IslandLongScreenshotCardModel: Equatable {
  static func == (lhs: IslandLongScreenshotCardModel, rhs: IslandLongScreenshotCardModel) -> Bool {
    lhs === rhs
  }
}
