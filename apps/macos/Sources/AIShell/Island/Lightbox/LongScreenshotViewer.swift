import AICore
import AppKit

/// The long screenshot's lightbox viewer: the whole image in an AppKit scroll view that zooms
/// from 25% to 200% (pinch, ⌘ with the wheel, the bar's buttons and keys) with no scroll
/// indicators, centred across its column (``LongScreenshotClipView``), its document the image at
/// its own point size in strips with the cover and the annotation canvas on it
/// (``LongScreenshotViewerDocument``), and over it the marks that keep the screen's scale
/// (``LongScreenshotViewerOverlay``). The lightbox hosts its ``container``.
///
/// It places the image where the lightbox opens it (``LongScreenshotViewport``, whose position
/// the motion grows the image to) once it has its size, then reports every scroll and zoom back
/// there for the rail, the page counter, the zoom label and the closing motion. The kept range,
/// the cover, the pages and the hovered page are the card's (``IslandLongScreenshotCardModel``),
/// shared with the card's own preview: the viewer drags the trim through it
/// (``LongScreenshotViewer+Trim``) and marks the page under the pointer through it. A drag on
/// the image moves it (``LongScreenshotViewer+Pan``).
final class LongScreenshotViewer {
  let container = LongScreenshotViewerContainer()
  let card: IslandLongScreenshotCardModel
  let viewport: LongScreenshotViewport
  let scroll = LongScreenshotScrollView()
  let clip = LongScreenshotClipView()
  let document: LongScreenshotViewerDocument
  let overlay: LongScreenshotViewerOverlay
  /// The opening zoom and position are applied: from then on the scroll view leads.
  private(set) var placed = false
  /// The trim bar being dragged (``LongScreenshotViewer+Trim``).
  var trim: LongScreenshotViewerTrim?
  /// The press on the image that may drag it, and the glide after a flick
  /// (``LongScreenshotViewer+Pan``).
  var pan: LongScreenshotViewerPan?
  var glide: LongScreenshotViewerGlide?
  /// Annotate mode: no trim bars and no page hover.
  private(set) var annotating = false
  private var observers: [NSObjectProtocol] = []

  init(
    card: IslandLongScreenshotCardModel, viewport: LongScreenshotViewport,
    labels: IslandLongScreenshotLabels, canvas: NSView
  ) {
    self.card = card
    self.viewport = viewport
    document = LongScreenshotViewerDocument(shot: card.source.shot, canvas: canvas)
    overlay = LongScreenshotViewerOverlay(card: card, labels: labels)
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
    for view in [scroll, overlay] as [NSView] {
      view.autoresizingMask = [.width, .height]
      container.addSubview(view)
    }
    container.onResize = { [weak self] in self?.placeIfNeeded() }
    scroll.onCommandScroll = { [weak self] in self?.commandScroll($0) ?? false }
    scroll.onWheel = { [weak self] in self?.stopGlide() }
    scroll.onSmartMagnify = { [weak self] event in
      guard let self else { return }
      toggleFit(around: document.convert(event.locationInWindow, from: nil))
    }
    document.onPress = { [weak self] in self?.beginPan($0) }
    document.onDrag = { [weak self] in self?.dragPan($0) }
    document.onRelease = { [weak self] in self?.endPan($0) }
    document.hover.moved = { [weak card] in card?.hoverPreview(at: $0.y) }
    document.hover.changed = { [weak card] in if !$0 { card?.hoverPreview(at: nil) } }
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
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
  }

  /// A click on the backdrop, outside the image and the chrome.
  var onBackdrop: () -> Void {
    get { clip.onBackdrop }
    set { clip.onBackdrop = newValue }
  }

  // MARK: Placing and following

  /// Puts the image where the lightbox opens it, once the scroll view has its size.
  private func placeIfNeeded() {
    guard !placed, container.bounds.width > 0, container.bounds.height > 0 else { return }
    scroll.frame = container.bounds
    overlay.frame = container.bounds
    scroll.tile()
    placed = true
    scroll.magnification = viewport.zoom
    move(to: viewport.origin)
  }

  /// The scroll view moved or zoomed: the viewport, the marks and the loaded strips follow.
  func sync() {
    guard placed else { return }
    viewport.update(origin: clip.bounds.origin, zoom: scroll.magnification, view: clip.frame.size)
    overlay.place(image: overlay.convert(document.bounds, from: document))
    document.load(near: clip.bounds)
  }

  /// Something of the card's that the marks show changed: the kept range, the cover, the pages,
  /// the hovered page or the focused bar.
  func refresh(annotating: Bool) {
    self.annotating = annotating
    overlay.annotating = annotating
    document.hover.enabled = !annotating && trim == nil
    document.cover(card.state.coveredAreas)
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
