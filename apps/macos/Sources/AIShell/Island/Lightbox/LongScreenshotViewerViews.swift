import AICore
import AppKit

// The viewer's own AppKit pieces (``LongScreenshotViewer``): the view the lightbox hosts, the
// scroll view and its clip view.

/// The viewer as the lightbox hosts it: the scroll view with the marks over it
/// (``LongScreenshotViewerOverlay``), both filling it. It reports every size it takes: the
/// viewer waits for the first to place the image where it opens, and follows the others as a
/// docked side panel narrows or widens its column.
final class LongScreenshotViewerContainer: NSView {
  var onResize: () -> Void = {}

  override var isFlipped: Bool { true }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    onResize()
  }
}

/// The scroll view: ⌘ with the wheel zooms around the pointer, as a pinch does
/// (``onCommandScroll``), and a two-finger double tap switches between Fit and 100%
/// (``onSmartMagnify``); everything else scrolls as usual, after telling the viewer
/// (``onWheel``), whose glide then stops.
final class LongScreenshotScrollView: NSScrollView {
  /// A wheel turned with ⌘ held: true when it zoomed.
  var onCommandScroll: (NSEvent) -> Bool = { _ in false }
  /// Any wheel or trackpad scroll, before it moves anything.
  var onWheel: () -> Void = {}
  /// A smart zoom gesture, in place of the scroll view's own.
  var onSmartMagnify: (NSEvent) -> Void = { _ in }

  override func scrollWheel(with event: NSEvent) {
    onWheel()
    if event.modifierFlags.contains(.command), onCommandScroll(event) { return }
    super.scrollWheel(with: event)
  }

  override func smartMagnify(with event: NSEvent) { onSmartMagnify(event) }
}

/// The scroll view's clip view: it stands only where the lightbox's layout lets it
/// (``LongScreenshotLightboxLayout/constrain(_:zoom:view:)``: the image centred across while it
/// is narrower than the column, the bars' room above and below it), so the scroll view's own
/// scrolling, magnifying and rubber-banding settle there too. A click on it, outside the image,
/// is a click on the backdrop (``onBackdrop``), which closes the lightbox.
final class LongScreenshotClipView: NSClipView {
  var layout: LongScreenshotLightboxLayout?
  var onBackdrop: () -> Void = {}
  /// Where a press on the backdrop went down (window points); nil while none did.
  private var press: NSPoint?

  override func constrainBoundsRect(_ proposedBounds: NSRect) -> NSRect {
    guard let layout, proposedBounds.width > 0, frame.width > 0 else {
      return super.constrainBoundsRect(proposedBounds)
    }
    let zoom = frame.width / proposedBounds.width
    let origin = layout.constrain(proposedBounds.origin, zoom: zoom, view: frame.size)
    return NSRect(origin: origin, size: proposedBounds.size)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    press = event.locationInWindow
  }

  /// A press let go about where it went down; a drag that only started there is not a click.
  override func mouseUp(with event: NSEvent) {
    defer { press = nil }
    guard let press else { return }
    let moved = hypot(event.locationInWindow.x - press.x, event.locationInWindow.y - press.y)
    if moved < 4 { onBackdrop() }
  }
}

/// The viewer's state that the lightbox's SwiftUI chrome reads: the layout, the zoom, the rows
/// between the bars and where the whole image stands, as the viewer (``LongScreenshotViewer``)
/// moves. Each is its own property, so a view reading one is not redrawn when another changes.
/// Before the viewer is placed they are where the lightbox opens, which its motion grows the
/// image to.
@Observable
final class LongScreenshotViewport {
  /// The lightbox's layout; it changes with the side panel's place (``setLayout(_:)``).
  private(set) var layout: LongScreenshotLightboxLayout
  /// Screen points per image point.
  private(set) var zoom: CGFloat
  /// The zoom fits the image's width (Fit), rather than a step, 100% or a pinch.
  private(set) var fitted: Bool
  /// The image rows between the bars.
  private(set) var visible: ClosedRange<CGFloat>
  /// The whole image's frame in the lightbox: the motion's ghost stands here while the image
  /// shows, so closing starts from where the image is.
  private(set) var imageFrame: CGRect
  /// A trim bar is being dragged: the chrome's hover sleeps, so the drag keeps its cursor.
  var trimming = false
  /// The scroller's top-left corner, image points.
  @ObservationIgnored private(set) var origin: CGPoint

  /// Where it opens: image row `start` about a third down, or else the kept range's `top`.
  init(layout: LongScreenshotLightboxLayout, start: CGFloat?, top: CGFloat) {
    self.layout = layout
    let zoom = layout.initialZoom
    let origin = layout.openingOrigin(start: start, top: top, zoom: zoom)
    self.zoom = zoom
    self.origin = origin
    fitted = zoom != 1
    visible = layout.visible(origin: origin, zoom: zoom, view: layout.column.size)
    imageFrame = layout.imageFrame(origin: origin, zoom: zoom)
  }

  /// The viewer stands at `origin` and `zoom` in a viewport of `view` (screen points).
  func update(origin: CGPoint, zoom: CGFloat, view: CGSize) {
    self.origin = origin
    if self.zoom != zoom { self.zoom = zoom }
    let visible = layout.visible(origin: origin, zoom: zoom, view: view)
    if self.visible != visible { self.visible = visible }
    let frame = layout.imageFrame(origin: origin, zoom: zoom)
    if imageFrame != frame { imageFrame = frame }
  }

  func setFitted(_ fitted: Bool) {
    if self.fitted != fitted { self.fitted = fitted }
  }

  /// The side panel moved: the column and the rail follow; the viewer then reports where it
  /// stands in it (``update(origin:zoom:view:)``).
  func setLayout(_ layout: LongScreenshotLightboxLayout) {
    if self.layout != layout { self.layout = layout }
  }
}
