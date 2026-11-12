import AICore
import AppKit

/// The viewer's document (``LongScreenshotViewer``): the whole long screenshot at its own point
/// size (origin top-left, image points), which the scroll view's magnification zooms. A long image
/// can be tens of thousands of pixels tall, more than one texture holds, so it is cut into strips
/// at most ``stripPixels`` tall (``LongScreenshotViewerStrip``), and only the strips near what
/// shows hold their pixels (``load(near:)``). Over them: the region that follows the pointer over
/// the image (``hover``); and on top the annotation canvas, which draws the card's annotations
/// (Cover Sensitive Info's mosaics among them) and takes the pointer only in annotate mode. A
/// press elsewhere on the image is the viewer's (``onPress``, ``onDrag``, ``onRelease``), which
/// drags the image with it (``LongScreenshotViewer+Pan``).
final class LongScreenshotViewerDocument: NSView {
  /// A strip's height at most, in pixels.
  static let stripPixels = 2048

  private let shot: LongScreenshotImage
  private var strips: [LongScreenshotViewerStrip] = []
  /// The page under the pointer, under the trim bars, which win over it. A press drags the image,
  /// so the pointer is an open hand here, closed while it drags.
  let hover = FloatingHoverRegionView()
  /// A press on the image (which is not a press on the backdrop), its drag and its release.
  var onPress: (NSEvent) -> Void = { _ in }
  var onDrag: (NSEvent) -> Void = { _ in }
  var onRelease: (NSEvent) -> Void = { _ in }

  init(shot: LongScreenshotImage, canvas: NSView) {
    self.shot = shot
    super.init(frame: CGRect(origin: .zero, size: shot.pointSize))
    wantsLayer = true
    let height = shot.image.height
    var top = 0
    while top < height {
      // Each strip overlaps the next by a row, so no seam shows between them at any zoom.
      let rows = top..<min(top + Self.stripPixels + 1, height)
      let strip = LongScreenshotViewerStrip(image: shot.image, rows: rows)
      strip.frame = CGRect(
        x: 0, y: CGFloat(rows.lowerBound) / shot.scale, width: bounds.width,
        height: CGFloat(rows.count) / shot.scale)
      addSubview(strip)
      strips.append(strip)
      top += Self.stripPixels
    }
    hover.pointer = .grab
    hover.frame = bounds
    addSubview(hover)
    canvas.frame = bounds
    addSubview(canvas)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var isFlipped: Bool { true }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// Taken here, so it never reaches the clip view as a click on the backdrop.
  override func mouseDown(with event: NSEvent) { onPress(event) }
  override func mouseDragged(with event: NSEvent) { onDrag(event) }
  override func mouseUp(with event: NSEvent) { onRelease(event) }

  /// The strips within a screen of `visible` (image points) hold their pixels; the others let
  /// them go.
  func load(near visible: CGRect) {
    let near = visible.insetBy(dx: 0, dy: -max(visible.height, 1))
    for strip in strips { strip.loaded = strip.frame.intersects(near) }
  }
}

/// One strip of the image: its pixel `rows` as its layer's contents while ``loaded``, scaled to
/// its frame. It takes no clicks: the document does.
///
/// The layer stays AppKit's own, set up in ``updateLayer()``: a view that makes its own backing
/// layer is never asked to update it, and AppKit's empty drawing then fills it, which left the
/// image blank.
private final class LongScreenshotViewerStrip: NSView {
  private let image: CGImage
  private let rows: Range<Int>
  private var crop: CGImage?

  var loaded = false {
    didSet {
      guard loaded != oldValue else { return }
      crop =
        loaded
        ? image.cropping(
          to: CGRect(x: 0, y: rows.lowerBound, width: image.width, height: rows.count))
        : nil
      needsDisplay = true
    }
  }

  init(image: CGImage, rows: Range<Int>) {
    self.image = image
    self.rows = rows
    super.init(frame: .zero)
    wantsLayer = true
    layerContentsRedrawPolicy = .onSetNeedsDisplay
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var wantsUpdateLayer: Bool { true }

  override func updateLayer() {
    guard let layer else { return }
    layer.minificationFilter = .trilinear
    layer.magnificationFilter = .linear
    layer.contents = crop
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
