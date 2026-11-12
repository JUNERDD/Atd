import AppKit

/// What text mode and the text commands show over a canvas, in the plan's prototype's accent
/// washes: a chip over every paragraph text mode can pick (lighter under the pointer, deeper and
/// outlined when picked), the selected characters, the marquee being drawn, a shimmer over the
/// paragraphs a running command reads, an outline on the paragraph of the item hovered on the
/// result card, and brief flashes (entering text mode, a result landing, an item clicked on the
/// card). A flipped, non-hitting subview of each ``AnnotationCanvasView`` whose bounds are the
/// canvas's, so its points are desktop points; it redraws on its own, without the annotations
/// under it, and runs a display link only while something moves. With Reduce Motion the shimmer
/// is a still wash and a flash shows without fading.
final class CaptureTextLayerView: NSView {
  /// A paragraph text mode can pick: its box (the lines' union), drawn a little larger.
  struct Chip: Equatable {
    let box: CGRect
    let hovered: Bool
    let picked: Bool
  }

  struct Scene: Equatable {
    var chips: [Chip] = []
    var characters: [CGRect] = []
    var marquee: CGRect?
    var reading: [CGRect] = []
    var hot: [CGRect] = []
  }

  /// How long a flash lasts, and when within it the flash is fully in (prototype keyframes).
  static let flashDuration: CFTimeInterval = 1.2
  /// One sweep of the reading shimmer.
  static let sweepDuration: CFTimeInterval = 1.5

  var scene = Scene() {
    didSet {
      guard scene != oldValue else { return }
      needsDisplay = true
      updateClock()
    }
  }

  private var flashes: [(boxes: [CGRect], start: CFTimeInterval)] = []
  private var link: CADisplayLink?

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// The wash around a paragraph's box (its lines' union).
  static func chip(around box: CGRect) -> CGRect { box.insetBy(dx: -3, dy: -2) }

  /// Flashes `boxes` (paragraph boxes) once.
  func flash(_ boxes: [CGRect]) {
    guard !boxes.isEmpty else { return }
    flashes.append((boxes.map(Self.chip(around:)), CACurrentMediaTime()))
    needsDisplay = true
    updateClock()
  }

  /// Stops animating: the canvas is going.
  func stop() {
    flashes = []
    link?.invalidate()
    link = nil
  }

  private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

  private func updateClock() {
    let animating = !flashes.isEmpty || (!scene.reading.isEmpty && !reduceMotion)
    if animating, link == nil, window != nil {
      let link = displayLink(target: self, selector: #selector(tick))
      link.add(to: .main, forMode: .common)
      self.link = link
    } else if !animating {
      link?.invalidate()
      link = nil
    }
  }

  @objc private func tick(_ link: CADisplayLink) {
    let now = CACurrentMediaTime()
    flashes.removeAll { now - $0.start > Self.flashDuration }
    needsDisplay = true
    updateClock()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { stop() } else { updateClock() }
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    let accent = NSColor.controlAccentColor
    for chip in scene.chips {
      let box = Self.chip(around: chip.box)
      let alpha: CGFloat = chip.picked ? 0.22 : chip.hovered ? 0.16 : 0.10
      Self.wash(box, radius: 6, fill: accent.withAlphaComponent(alpha), in: context)
      Self.edge(
        box, radius: 6, color: accent.withAlphaComponent(chip.picked ? 0.95 : 0.40),
        width: chip.picked ? 1.5 : 1, in: context)
    }
    for rect in scene.characters {
      context.setFillColor(accent.withAlphaComponent(0.30).cgColor)
      context.fill(rect)
    }
    if let marquee = scene.marquee {
      Self.wash(marquee, radius: 3, fill: accent.withAlphaComponent(0.10), in: context)
      Self.edge(marquee, radius: 3, color: accent.withAlphaComponent(0.95), width: 1, in: context)
    }
    let now = CACurrentMediaTime()
    for box in scene.reading { drawShimmer(Self.chip(around: box), now: now, in: context) }
    for box in scene.hot {
      let chip = Self.chip(around: box)
      Self.wash(chip, radius: 6, fill: accent.withAlphaComponent(0.16), in: context)
      Self.edge(chip, radius: 6, color: accent.withAlphaComponent(0.95), width: 1.5, in: context)
    }
    for flash in flashes {
      let opacity = reduceMotion ? 1 : Self.flashOpacity((now - flash.start) / Self.flashDuration)
      for box in flash.boxes {
        Self.wash(box, radius: 6, fill: accent.withAlphaComponent(0.16 * opacity), in: context)
        Self.edge(
          box, radius: 6, color: accent.withAlphaComponent(0.95 * opacity), width: 1.5,
          in: context)
      }
    }
  }

  /// A band 60% of the box wide sweeping across it (clear, accent, white, accent, clear), inside
  /// a faint edge; a still wash with Reduce Motion.
  private func drawShimmer(_ box: CGRect, now: CFTimeInterval, in context: CGContext) {
    let accent = NSColor.controlAccentColor
    Self.edge(box, radius: 6, color: accent.withAlphaComponent(0.40), width: 1, in: context)
    guard !reduceMotion else {
      Self.wash(box, radius: 6, fill: accent.withAlphaComponent(0.14), in: context)
      return
    }
    let band = box.width * 0.6
    let phase = now.truncatingRemainder(dividingBy: Self.sweepDuration) / Self.sweepDuration
    let start = box.minX - band + (box.width + band) * phase
    let colors = [
      NSColor.clear, accent.withAlphaComponent(0.2), NSColor.white.withAlphaComponent(0.55),
      accent.withAlphaComponent(0.2), NSColor.clear,
    ].map(\.cgColor)
    guard
      let gradient = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray,
        locations: [0, 0.25, 0.5, 0.75, 1])
    else { return }
    context.saveGState()
    context.addPath(Self.rounded(box, radius: 6))
    context.clip()
    context.drawLinearGradient(
      gradient, start: CGPoint(x: start, y: box.midY), end: CGPoint(x: start + band, y: box.midY),
      options: [])
    context.restoreGState()
  }

  /// The prototype's flash keyframes: in over the first 22%, held to 65%, out by the end.
  private static func flashOpacity(_ progress: Double) -> CGFloat {
    switch progress {
    case ..<0.22: CGFloat(max(progress, 0) / 0.22)
    case ..<0.65: 1
    default: CGFloat(max(0, 1 - (progress - 0.65) / 0.35))
    }
  }

  private static func wash(_ rect: CGRect, radius: CGFloat, fill: NSColor, in context: CGContext) {
    guard rect.width > 0, rect.height > 0 else { return }
    context.setFillColor(fill.cgColor)
    context.addPath(rounded(rect, radius: radius))
    context.fillPath()
  }

  /// A stroke inside `rect`'s edge, so it stays crisp at any width.
  private static func edge(
    _ rect: CGRect, radius: CGFloat, color: NSColor, width: CGFloat, in context: CGContext
  ) {
    let inset = rect.insetBy(dx: width / 2, dy: width / 2)
    guard inset.width > 0, inset.height > 0 else { return }
    context.setStrokeColor(color.cgColor)
    context.setLineWidth(width)
    context.addPath(rounded(inset, radius: max(radius - width / 2, 0)))
    context.strokePath()
  }

  /// A rounded rect whose corners fit it: Core Graphics refuses a radius past half a side, which a
  /// marquee just begun or a thin line can be.
  private static func rounded(_ rect: CGRect, radius: CGFloat) -> CGPath {
    let corner = min(radius, rect.width / 2, rect.height / 2)
    return CGPath(roundedRect: rect, cornerWidth: corner, cornerHeight: corner, transform: nil)
  }
}
