import AICore
import AppKit

/// The long screenshot's lightbox viewer: the whole image in an AppKit scroll view that zooms
/// from 25% to 200% (pinch, ⌘ with the wheel, the bar's buttons and keys) with no scroll
/// indicators, centred across its column (``LongScreenshotClipView``), its document the image at
/// its own point size in strips with the annotation canvas on it (``LongScreenshotViewerDocument``),
/// and over it the marks that keep the screen's scale: the recognized text's
/// (``LongScreenshotViewerPicks``) and the kept range's (``LongScreenshotViewerOverlay``). The
/// lightbox hosts its ``container``.
///
/// It places the image where the lightbox opens it (``LongScreenshotViewport``, whose position
/// the motion grows the image to) once it has its size, then reports every scroll and zoom back
/// there for the rail, the page counter, the zoom label and the closing motion; when a docked side
/// panel changes its column's width it keeps its zoom (refitting only at Fit) and the row at the
/// top of the view (``relayout(_:)``). The kept range,
/// the pages and the hovered page are the card's (``IslandLongScreenshotCardModel``), shared with
/// the card's own preview: the viewer drags the trim through it (``LongScreenshotViewer+Trim``)
/// and marks the page under the pointer through it. A drag on the image moves it
/// (``LongScreenshotViewer+Pan``), or in text mode draws a marquee over its text, and a click
/// picks a paragraph (``LongScreenshotViewer+Select``).
final class LongScreenshotViewer {
  let container = LongScreenshotViewerContainer()
  let card: IslandLongScreenshotCardModel
  let viewport: LongScreenshotViewport
  let scroll = LongScreenshotScrollView()
  let clip = LongScreenshotClipView()
  let document: LongScreenshotViewerDocument
  let overlay: LongScreenshotViewerOverlay
  /// The recognized text the viewer picks from, and its marks.
  let text: LongScreenshotTextModel
  let picks: LongScreenshotViewerPicks
  /// The opening zoom and position are applied: from then on the scroll view leads.
  private(set) var placed = false
  /// The trim bar being dragged (``LongScreenshotViewer+Trim``).
  var trim: LongScreenshotViewerTrim?
  /// The press on the image that may drag it, and the glide after a flick
  /// (``LongScreenshotViewer+Pan``).
  var pan: LongScreenshotViewerPan?
  var glide: LongScreenshotViewerGlide?
  /// The marquee being dragged in text mode (``LongScreenshotViewer+Select``).
  var marquee: LongScreenshotViewerMarquee?
  /// Space is held in text mode: a drag moves the image rather than drawing a marquee.
  var panKeyHeld = false
  /// A click on the image picked at an image point with these modifiers.
  var onPick: (CGPoint, NSEvent.ModifierFlags) -> Void = { _, _ in }
  /// Whether a click at an image point opens a result card (a run's step badge or mark), which the
  /// pointer shows in text mode.
  var opensCard: (CGPoint) -> Bool = { _ in false }
  /// The lightbox's mode: trim bars and the page hover only in view mode, the marquee only in
  /// text mode, and the canvas's own pointer only in annotate mode.
  private(set) var mode = LongScreenshotLightboxMode.view
  private var observers: [NSObjectProtocol] = []

  init(
    card: IslandLongScreenshotCardModel, viewport: LongScreenshotViewport,
    labels: IslandLongScreenshotLabels, canvas: NSView, text: LongScreenshotTextModel
  ) {
    self.card = card
    self.viewport = viewport
    self.text = text
    document = LongScreenshotViewerDocument(shot: card.source.shot, canvas: canvas)
    overlay = LongScreenshotViewerOverlay(card: card, labels: labels)
    picks = LongScreenshotViewerPicks(text: text)
    clip.layout = viewport.layout
    clip.drawsBackground = false
    clip.postsBoundsChangedNotifications = true
    scroll.contentView = clip
    scroll.documentView = document
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    scroll.hasVerticalScroller = false
    scroll.hasHorizontalScroller = false
    scroll.automaticallyAdjustsContentInsets = false
    // The room above and below the image, as insets too: AppKit's own scrolling (a trackpad's,
    // which settles where the document and its insets end) then reaches it, as the clip view's
    // constraint does at every zoom.
    let pad = viewport.layout.padding
    scroll.contentInsets = NSEdgeInsets(top: pad.top, left: 0, bottom: pad.bottom, right: 0)
    scroll.allowsMagnification = true
    scroll.minMagnification = LongScreenshotLightboxLayout.minZoom
    scroll.maxMagnification = LongScreenshotLightboxLayout.maxZoom
    scroll.setAccessibilityLabel(labels.preview)
    for view in [scroll, picks, overlay] as [NSView] {
      view.autoresizingMask = [.width, .height]
      container.addSubview(view)
    }
    container.onResize = { [weak self] in self?.resized() }
    scroll.onCommandScroll = { [weak self] in self?.commandScroll($0) ?? false }
    scroll.onWheel = { [weak self] in self?.stopGlide() }
    scroll.onSmartMagnify = { [weak self] event in
      guard let self else { return }
      toggleFit(around: document.convert(event.locationInWindow, from: nil))
    }
    document.onPress = { [weak self] in self?.press($0) }
    document.onDrag = { [weak self] in self?.drag($0) }
    document.onRelease = { [weak self] in self?.release($0) }
    document.hover.moved = { [weak self] in self?.pointerMoved(to: $0) }
    document.hover.changed = { [weak self] in if !$0 { self?.pointerLeft() } }
    wireTrim()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: NSView.boundsDidChangeNotification, object: clip, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.sync() } },
      center.addObserver(
        forName: NSScrollView.willStartLiveMagnifyNotification, object: scroll, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.stopGlide()
          self?.viewport.setFitted(false)
        }
      },
    ]
  }

  isolated deinit {
    glide?.timer.invalidate()
    marquee?.timer.invalidate()
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
  }

  /// A click on the backdrop, outside the image and the chrome.
  var onBackdrop: () -> Void {
    get { clip.onBackdrop }
    set { clip.onBackdrop = newValue }
  }

  // MARK: Placing and following

  /// The side panel docked or went (or became a drawer): the clip view stands by `layout`, whose
  /// column the container takes next (``resized()``).
  func relayout(_ layout: LongScreenshotLightboxLayout) {
    guard layout != viewport.layout else { return }
    viewport.setLayout(layout)
    clip.layout = layout
  }

  /// The container took a size: the image is placed where the lightbox opens it, the first time;
  /// afterwards the column changed width, and the row at the top of the view stays there at the
  /// same zoom, or at the new Fit zoom while it is fitted.
  private func resized() {
    guard placed else { return placeIfNeeded() }
    let layout = viewport.layout
    let row = clip.bounds.minY + layout.visibleInsets.top / scroll.magnification
    if viewport.fitted, abs(scroll.magnification - layout.fitZoom) > 0.0001 {
      scroll.magnification = layout.fitZoom
    }
    setOrigin(
      CGPoint(
        x: clip.bounds.minX, y: layout.originY(visibleTop: row, zoom: scroll.magnification)))
  }

  /// Puts the image where the lightbox opens it, once the scroll view has its size.
  private func placeIfNeeded() {
    guard !placed, container.bounds.width > 0, container.bounds.height > 0 else { return }
    scroll.frame = container.bounds
    picks.frame = container.bounds
    overlay.frame = container.bounds
    scroll.tile()
    placed = true
    scroll.magnification = viewport.zoom
    move(to: viewport.origin)
  }

  /// The scroll view moved or zoomed: the viewport, the marks, the loaded strips and a marquee
  /// being dragged follow, so a scroll mid-drag extends the marquee.
  func sync() {
    guard placed else { return }
    viewport.update(origin: clip.bounds.origin, zoom: scroll.magnification, view: clip.frame.size)
    let image = overlay.convert(document.bounds, from: document)
    overlay.place(image: image)
    picks.place(image: image, height: document.bounds.height)
    document.load(near: clip.bounds)
    updateMarquee()
  }

  /// Something the marks show changed: the mode, or the card's kept range, annotations, pages,
  /// hovered page or focused bar.
  func refresh(mode: LongScreenshotLightboxMode) {
    if self.mode != mode {
      self.mode = mode
      modeChanged()
    }
    overlay.editing = mode != .view
    // Annotate mode edits what is drawn; the picks wait for view or text mode.
    picks.isHidden = mode == .annotate
    document.hover.enabled = mode != .annotate && trim == nil
    overlay.refresh()
  }

  // MARK: Scrolling

  /// Moves the scroller's top-left corner to `origin` (image points), within its limits; a glide
  /// stops.
  func move(to origin: CGPoint, animated: Bool = false) {
    stopGlide()
    guard animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      return setOrigin(origin)
    }
    let target = clip.constrainBoundsRect(NSRect(origin: origin, size: clip.bounds.size)).origin
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.25
      context.allowsImplicitAnimation = true
      clip.animator().setBoundsOrigin(target)
    }
    scroll.reflectScrolledClipView(clip)
    sync()
  }

  /// Puts the scroller's top-left corner at `origin` at once, within its limits, leaving a
  /// glide going (it moves the image this way).
  func setOrigin(_ origin: CGPoint) {
    clip.setBoundsOrigin(
      clip.constrainBoundsRect(NSRect(origin: origin, size: clip.bounds.size)).origin)
    scroll.reflectScrolledClipView(clip)
    sync()
  }

  /// Scrolls by `points` on the screen, down for positive.
  func scroll(by points: CGFloat) {
    let origin = clip.bounds.origin
    move(to: CGPoint(x: origin.x, y: origin.y + points / scroll.magnification))
  }

  /// Shows image row `y` just below the top bar.
  func show(y: CGFloat, animated: Bool) {
    let layout = viewport.layout
    let top = layout.visibleInsets.top + LongScreenshotLightboxLayout.landing
    move(
      to: CGPoint(x: clip.bounds.minX, y: y - top / scroll.magnification), animated: animated)
  }

  /// The page `step` pages from the counter's (``currentPage``), at the top.
  func showPage(_ step: Int) {
    let pages = card.pages
    guard let current = currentPage else { return }
    let index = min(max(current + step, 0), pages.count - 1)
    show(y: pages[index].top, animated: true)
  }

  /// The page the counter names.
  var currentPage: Int? {
    LongScreenshotLightboxLayout.currentPage(viewport.visible, pages: card.pages)
  }

  /// The rail moved the visible rows' top to `top` (image points).
  func scrollRail(visibleTop top: CGFloat) {
    let y = viewport.layout.originY(visibleTop: top, zoom: scroll.magnification)
    move(to: CGPoint(x: clip.bounds.minX, y: y))
  }

  // MARK: Zooming

  /// Zooms to `zoom` around the viewport's middle (or `anchor`, document points), keeping the
  /// image centred across while it fits; `fitted` when it is the Fit zoom.
  func zoom(to zoom: CGFloat, fitted: Bool = false, around anchor: CGPoint? = nil) {
    let zoom = LongScreenshotLightboxLayout.clamp(zoom: zoom)
    let bounds = clip.bounds
    scroll.setMagnification(zoom, centeredAt: anchor ?? CGPoint(x: bounds.midX, y: bounds.midY))
    viewport.setFitted(fitted)
    move(to: clip.bounds.origin)
  }

  func zoomIn() { zoom(to: LongScreenshotLightboxLayout.zoomIn(from: scroll.magnification)) }
  func zoomOut() { zoom(to: LongScreenshotLightboxLayout.zoomOut(from: scroll.magnification)) }

  /// Fit ⇄ 100%: the % label, 0, and a two-finger double tap (smart zoom) around `anchor`
  /// (document points).
  func toggleFit(around anchor: CGPoint? = nil) {
    if abs(scroll.magnification - 1) < 0.01 {
      zoom(to: viewport.layout.fitZoom, fitted: true, around: anchor)
    } else {
      zoom(to: 1, around: anchor)
    }
  }

  /// ⌘ with the wheel: zooms continuously around the pointer.
  private func commandScroll(_ event: NSEvent) -> Bool {
    let delta = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 8
    guard delta != 0 else { return true }
    let anchor = document.convert(event.locationInWindow, from: nil)
    zoom(to: scroll.magnification * exp(delta * 0.01), around: anchor)
    return true
  }

  // MARK: Showing

  /// Shows the viewer (the image has landed) or hides it (the motion's ghost stands in).
  func setShown(_ shown: Bool) {
    guard container.isHidden == shown else { return }
    container.isHidden = !shown
    if shown {
      sync()
    } else {
      endTrim()
      stopPan()
      cancelMarquee()
    }
  }

  /// Fades the viewer to `opacity` where nothing moves (Reduce Motion, no card media to grow
  /// from).
  func fade(to opacity: CGFloat) {
    guard container.alphaValue != opacity else { return }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = IslandChoreography.lightboxReducedFade
      container.animator().alphaValue = opacity
    }
  }
}
