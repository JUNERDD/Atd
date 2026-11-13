import AICore
import AppKit

/// What the viewer marks over the image (``LongScreenshotViewer``), above the scroll view so it
/// keeps the screen's scale at any zoom: the shade outside the kept range, the dashed splits
/// between the pages Atd reads, a "Page N" tag at each page's top-left, the hovered page's accent
/// outline (the page the card's rows mark too) and the two trim bars. The viewer gives it the
/// image's frame after every scroll and zoom (``place(image:)``); it reads the kept range and the
/// pages from the card it shares with the card's own preview (``refresh()``).
///
/// It takes the pointer only on the trim bars, and not at all in annotate or text mode, where the
/// bars and the page hover are hidden and the shade stays; everything else goes through to the
/// scroll view under it.
final class LongScreenshotViewerOverlay: NSView {
  private let card: IslandLongScreenshotCardModel
  private let labels: IslandLongScreenshotLabels
  private let shadeAbove = LongScreenshotViewerFill.shade()
  private let shadeBelow = LongScreenshotViewerFill.shade()
  private let outline = LongScreenshotViewerFill.outline()
  private var splits: [LongScreenshotViewerDash] = []
  private var tags: [LongScreenshotViewerTag] = []
  let bars: [LongScreenshotViewerTrimBar]
  /// Each bar's hover, which gives it the row-resize cursor; a dragged bar's covers the whole
  /// overlay, so the drag keeps its cursor wherever the pointer goes.
  private let hovers: [FloatingHoverRegionView]
  /// The image's frame in this view.
  private var image = CGRect.zero

  /// Annotate or text mode: no trim bars, no page hover.
  var editing = false {
    didSet { if editing != oldValue { refresh() } }
  }

  /// The bar being dragged, whose hover covers the overlay.
  var dragging: LongScreenshotCardState.Edge? {
    didSet { if dragging != oldValue { refresh() } }
  }

  init(card: IslandLongScreenshotCardModel, labels: IslandLongScreenshotLabels) {
    self.card = card
    self.labels = labels
    bars = [
      LongScreenshotViewerTrimBar(edge: .top, label: labels.trimTop),
      LongScreenshotViewerTrimBar(edge: .bottom, label: labels.trimBottom),
    ]
    hovers = bars.map { _ in FloatingHoverRegionView() }
    super.init(frame: .zero)
    wantsLayer = true
    clipsToBounds = true
    for view in [shadeAbove, shadeBelow, outline] { addSubview(view) }
    for (bar, hover) in zip(bars, hovers) {
      hover.pointer = .resizeRow
      hover.changed = { [weak bar] in bar?.hovered = $0 }
      addSubview(bar)
      addSubview(hover)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var isFlipped: Bool { true }

  /// Only a shown trim bar takes the pointer.
  override func hitTest(_ point: NSPoint) -> NSView? {
    guard !editing, let superview else { return nil }
    let local = convert(point, from: superview)
    return bars.first { !$0.isHidden && $0.frame.contains(local) }
  }

  /// The image now stands at `image` (this view's points).
  func place(image: CGRect) {
    guard self.image != image else { return }
    self.image = image
    refresh()
  }

  /// Lays every mark out again from the card's kept range, pages, hovered page and focused bar.
  func refresh() {
    let state = card.state
    let kept = state.kept
    let scale = image.height / max(state.height, 1)
    let y = { (value: CGFloat) in self.image.minY + value * scale }
    shadeAbove.frame = CGRect(
      x: image.minX, y: image.minY, width: image.width, height: kept.top * scale)
    shadeBelow.frame = CGRect(
      x: image.minX, y: y(kept.bottom), width: image.width,
      height: max(state.height - kept.bottom, 0) * scale)
    placePages(card.pages, y: y, scale: scale)
    placeBars(kept, y: y)
  }

  private func placePages(
    _ pages: [LongScreenshotCardPage], y: (CGFloat) -> CGFloat, scale: CGFloat
  ) {
    while splits.count < pages.count {
      let split = LongScreenshotViewerDash(frame: .zero)
      let tag = LongScreenshotViewerTag(.page)
      tag.text = labels.page(tags.count + 1)
      addSubview(split, positioned: .below, relativeTo: outline)
      addSubview(tag, positioned: .below, relativeTo: outline)
      splits.append(split)
      tags.append(tag)
    }
    for (index, (split, tag)) in zip(splits, tags).enumerated() {
      guard index < pages.count else {
        split.isHidden = true
        tag.isHidden = true
        continue
      }
      let top = y(pages[index].top)
      split.isHidden = index == 0
      split.frame = CGRect(x: image.minX, y: top - 1, width: image.width, height: 2)
      tag.isHidden = false
      tag.setFrameSize(tag.size)
      tag.setFrameOrigin(NSPoint(x: image.minX + 8, y: top + 8))
    }
    let hovered =
      editing ? nil : card.hoveredPage.flatMap { pages.indices.contains($0) ? $0 : nil }
    outline.isHidden = hovered == nil
    if let hovered {
      let page = pages[hovered]
      outline.frame = CGRect(
        x: image.minX, y: y(page.top), width: image.width, height: (page.bottom - page.top) * scale)
    }
  }

  private func placeBars(_ kept: LongScreenshotKept, y: (CGFloat) -> CGFloat) {
    let hit = IslandMetrics.longScreenshotHandleHit
    let overhang = IslandMetrics.longScreenshotHandleOverhang
    for (bar, hover) in zip(bars, hovers) {
      let value = bar.edge == .top ? kept.top : kept.bottom
      bar.isHidden = editing
      bar.frame = CGRect(
        x: image.minX - overhang, y: y(value) - hit / 2, width: image.width + overhang * 2,
        height: hit)
      bar.text = labels.trimTab(bar.edge, IslandLongScreenshotLabels.points(value))
      bar.focused = card.focusedHandle == bar.edge
      bar.dragging = dragging == bar.edge
      hover.enabled = !editing && (dragging == nil || dragging == bar.edge)
      hover.frame = dragging == bar.edge ? bounds : bar.frame
    }
  }
}
