import AICore
import AppKit

// The pieces the viewer's overlay (``LongScreenshotViewerOverlay``) draws over the image at the
// screen's own scale, whatever the zoom: plain fills and outlines, the dashed page splits and
// the capsule tags (the page labels, a trim bar's value). None of them takes the pointer.

/// A rectangle styled on its layer (`style`, run again when the appearance changes, so dynamic
/// colours resolve in the view's own): a shade, the hovered page's outline, a bar, a focus ring.
final class LongScreenshotViewerFill: NSView {
  private let style: (CALayer) -> Void

  init(style: @escaping (CALayer) -> Void) {
    self.style = style
    super.init(frame: .zero)
    wantsLayer = true
    layerContentsRedrawPolicy = .onSetNeedsDisplay
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var wantsUpdateLayer: Bool { true }
  override func updateLayer() { if let layer { style(layer) } }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Black at 55% outside the kept range, as on the card's preview.
  static func shade() -> LongScreenshotViewerFill {
    LongScreenshotViewerFill { $0.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor }
  }

  /// The hovered page's 2 pt outline in the accent colour, inside its rows.
  static func outline() -> LongScreenshotViewerFill {
    LongScreenshotViewerFill { layer in
      layer.borderWidth = 2
      layer.borderColor = NSColor.controlAccentColor.cgColor
      layer.cornerRadius = 2
    }
  }
}

/// A page split: a white dashed line across the image over a faint dark band, so it shows on
/// light and dark pages alike.
final class LongScreenshotViewerDash: NSView {
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layerContentsRedrawPolicy = .onSetNeedsDisplay
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func setFrameSize(_ newSize: NSSize) {
    let resized = newSize.width != frame.width
    super.setFrameSize(newSize)
    if resized { needsDisplay = true }
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.black.withAlphaComponent(0.25).setFill()
    bounds.fill()
    let line = NSBezierPath()
    line.move(to: NSPoint(x: 0, y: bounds.midY))
    line.line(to: NSPoint(x: bounds.maxX, y: bounds.midY))
    line.lineWidth = 1
    line.setLineDash([4, 3], count: 2, phase: 0)
    NSColor.white.withAlphaComponent(0.9).setStroke()
    line.stroke()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// A capsule with one line of text: a page's "Page N" in white on black, or a trim bar's value
/// in dark text on its yellow, as large as its text needs (``size``).
final class LongScreenshotViewerTag: NSView {
  enum Style {
    case page, trim
  }

  private let style: Style
  /// The capsule's size for ``text``, measured once per text.
  private(set) var size = NSSize.zero
  var text = "" {
    didSet {
      guard text != oldValue else { return }
      size = NSSize(width: (attributed.size().width + padding * 2).rounded(.up), height: height)
      needsDisplay = true
    }
  }

  init(_ style: Style) {
    self.style = style
    super.init(frame: .zero)
    wantsLayer = true
    layerContentsRedrawPolicy = .onSetNeedsDisplay
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private var font: NSFont {
    NSFont.monospacedDigitSystemFont(ofSize: 11, weight: style == .page ? .regular : .semibold)
  }

  private var padding: CGFloat { style == .page ? 8 : 9 }
  private var height: CGFloat { style == .page ? 20 : 22 }

  private var attributed: NSAttributedString {
    let color =
      style == .page ? NSColor.white : NSColor(srgbRed: 0.106, green: 0.075, blue: 0, alpha: 1)
    return NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
  }

  override func draw(_ dirtyRect: NSRect) {
    let fill =
      style == .page ? NSColor.black.withAlphaComponent(0.62) : NSColor.systemYellow
    fill.setFill()
    NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2)
      .fill()
    let string = attributed
    let size = string.size()
    string.draw(
      at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// One end of the kept range on the viewer: a yellow bar across the image and 8 pt past it on
/// both sides, in a strip 16 pt tall that takes the pointer (as the card's handles), with a tab
/// naming where it stands ("Start · 1,234 pt") while it is hovered, dragged or takes the arrow
/// keys (``focused``, ringed then). Presses go to its owner (``onPress``, ``onDrag``,
/// ``onRelease``), which drags the kept range with autoscroll; VoiceOver adjusts it as a slider.
final class LongScreenshotViewerTrimBar: NSView {
  let edge: LongScreenshotCardState.Edge
  var onPress: (NSEvent) -> Void = { _ in }
  var onDrag: (NSEvent) -> Void = { _ in }
  var onRelease: () -> Void = {}
  /// VoiceOver's increment (down the image) and decrement.
  var onAdjust: (_ down: Bool) -> Void = { _ in }

  private let bar = LongScreenshotViewerFill { layer in
    layer.backgroundColor = NSColor.systemYellow.cgColor
    layer.borderColor = NSColor.black.withAlphaComponent(0.35).cgColor
    layer.borderWidth = 0.5
    layer.cornerRadius = IslandMetrics.longScreenshotHandleBar / 2
  }
  private let ring = LongScreenshotViewerFill { layer in
    layer.borderColor = NSColor.keyboardFocusIndicatorColor.cgColor
    layer.borderWidth = 2
    layer.cornerRadius = 4
  }
  private let tab = LongScreenshotViewerTag(.trim)

  var text = "" {
    didSet {
      guard text != oldValue else { return }
      tab.text = text
      placeSubviews()
      setAccessibilityValue(text)
    }
  }
  var focused = false { didSet { refresh() } }
  var hovered = false { didSet { refresh() } }
  var dragging = false { didSet { refresh() } }

  init(edge: LongScreenshotCardState.Edge, label: String) {
    self.edge = edge
    super.init(frame: .zero)
    wantsLayer = true
    clipsToBounds = false
    addSubview(bar)
    addSubview(ring)
    addSubview(tab)
    setAccessibilityElement(true)
    setAccessibilityRole(.slider)
    setAccessibilityLabel(label)
    refresh()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var isFlipped: Bool { true }

  private func refresh() {
    ring.isHidden = !focused
    tab.isHidden = !(focused || hovered || dragging)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    placeSubviews()
  }

  private func placeSubviews() {
    let height = IslandMetrics.longScreenshotHandleBar
    bar.frame = CGRect(x: 0, y: (bounds.height - height) / 2, width: bounds.width, height: height)
    ring.frame = bounds.insetBy(dx: 0, dy: 1)
    let size = tab.size
    tab.frame = CGRect(
      x: bounds.width - 18 - size.width, y: (bounds.height - size.height) / 2,
      width: size.width, height: size.height)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseDown(with event: NSEvent) { onPress(event) }
  override func mouseDragged(with event: NSEvent) { onDrag(event) }
  override func mouseUp(with event: NSEvent) { onRelease() }

  override func accessibilityPerformIncrement() -> Bool {
    onAdjust(true)
    return true
  }

  override func accessibilityPerformDecrement() -> Bool {
    onAdjust(false)
    return true
  }
}
