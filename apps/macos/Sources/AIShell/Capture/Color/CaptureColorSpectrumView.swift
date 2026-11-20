import AICore
import AppKit

/// Interactive 2D HSB saturation/brightness canvas + rainbow hue slider + checkerboard opacity bar
/// (`232 × 136 pt`). Never takes first responder so dragging never interrupts open text editing.
@MainActor
final class CaptureColorSpectrumView: NSView {
  private enum DragTarget { case spectrum, hue, alpha }

  static let preferredSize = NSSize(width: 232, height: 136)

  var onColorChange: ((AnnotationRGBA, UUID?) -> Void)?
  var onColorCommit: ((AnnotationRGBA) -> Void)?

  private var hue: CGFloat = 0
  private var saturation: CGFloat = 1
  private var brightness: CGFloat = 1
  private var colorAlpha: CGFloat = 1
  private var activeTarget: DragTarget?
  private var gestureBurst: UUID?
  private let wheelBurst = CaptureWheelBurst()
  private var hasPendingWheelCommit = false
  private let srgb = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

  override init(frame frameRect: NSRect) {
    super.init(frame: NSRect(origin: frameRect.origin, size: Self.preferredSize))
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override var intrinsicContentSize: NSSize { Self.preferredSize }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { wheelBurst.reset() }
  }

  func finishWheelIfNeeded() {
    wheelBurst.reset()
    guard hasPendingWheelCommit else { return }
    hasPendingWheelCommit = false
    onColorCommit?(currentRGBA)
  }

  var currentRGBA: AnnotationRGBA {
    let rgb = AnnotationIcons.hsbToSRGB(hue: hue, saturation: saturation, brightness: brightness)
    return AnnotationRGBA(red: rgb.r, green: rgb.g, blue: rgb.b, alpha: colorAlpha)
  }

  func setColor(_ rgba: AnnotationRGBA) {
    let cur = currentRGBA
    let eps = 0.002
    if abs(cur.red - rgba.red) < eps, abs(cur.green - rgba.green) < eps,
      abs(cur.blue - rgba.blue) < eps, abs(cur.alpha - rgba.alpha) < eps
    {
      return
    }
    hasPendingWheelCommit = false
    wheelBurst.reset()
    let hsb = Self.srgbToHSB(r: rgba.red, g: rgba.green, b: rgba.blue)
    if hsb.s > 0.001 { hue = hsb.h }
    if hsb.b > 0.001 { saturation = hsb.s }
    brightness = hsb.b
    colorAlpha = rgba.alpha
    needsDisplay = true
  }

  private var spectrumRect: CGRect {
    CGRect(x: 0, y: 0, width: bounds.width, height: max(40, bounds.height - 40))
  }
  private var hueRect: CGRect {
    CGRect(x: 0, y: spectrumRect.maxY + 8, width: bounds.width, height: 12)
  }
  private var alphaRect: CGRect {
    CGRect(x: 0, y: hueRect.maxY + 8, width: bounds.width, height: 12)
  }
  private let thumbInset: CGFloat = 6

  override func mouseDown(with event: NSEvent) {
    hasPendingWheelCommit = false
    wheelBurst.reset()
    let pt = convert(event.locationInWindow, from: nil)
    if pt.y <= spectrumRect.maxY + 4 {
      activeTarget = .spectrum
    } else if pt.y <= hueRect.maxY + 4 {
      activeTarget = .hue
    } else {
      activeTarget = .alpha
    }
    let burst = UUID()
    gestureBurst = burst
    update(at: pt)
    onColorChange?(currentRGBA, burst)
  }

  override func mouseDragged(with event: NSEvent) {
    guard activeTarget != nil else { return }
    let before = currentRGBA
    update(at: convert(event.locationInWindow, from: nil))
    let next = currentRGBA
    if !Self.isClose(before, next) {
      onColorChange?(next, gestureBurst)
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard activeTarget != nil else { return }
    update(at: convert(event.locationInWindow, from: nil))
    let final = currentRGBA
    onColorChange?(final, gestureBurst)
    onColorCommit?(final)
    activeTarget = nil
    gestureBurst = nil
  }

  override func scrollWheel(with event: NSEvent) {
    let pt = convert(event.locationInWindow, from: nil)
    let onHue = pt.y >= hueRect.minY - 4 && pt.y <= hueRect.maxY + 4
    let onAlpha = !onHue && pt.y >= alphaRect.minY - 4 && pt.y <= alphaRect.maxY + 4
    guard onHue || onAlpha else {
      super.scrollWheel(with: event)
      return
    }
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return
    case .delta(let unit):
      let before = currentRGBA
      if onHue {
        let nextHue = Self.clamp(hue + CGFloat(unit))
        guard abs(nextHue - hue) > 1e-6 else { return }
        hue = nextHue
      } else {
        let nextAlpha = Self.clamp(colorAlpha + CGFloat(unit))
        guard abs(nextAlpha - colorAlpha) > 1e-6 else { return }
        colorAlpha = nextAlpha
      }
      needsDisplay = true
      let next = currentRGBA
      guard !Self.isClose(before, next) else { return }
      hasPendingWheelCommit = true
      let burst = wheelBurst.next(for: event) { [weak self] in
        guard let self, self.hasPendingWheelCommit else { return }
        self.hasPendingWheelCommit = false
        self.onColorCommit?(self.currentRGBA)
      }
      onColorChange?(next, burst)
    }
  }

  private func update(at point: CGPoint) {
    let (oldH, oldS, oldB, oldA) = (hue, saturation, brightness, colorAlpha)
    switch activeTarget {
    case .spectrum:
      saturation = Self.clamp((point.x - spectrumRect.minX) / max(1, spectrumRect.width))
      brightness = 1 - Self.clamp((point.y - spectrumRect.minY) / max(1, spectrumRect.height))
    case .hue:
      let span = max(1, hueRect.width - thumbInset * 2)
      hue = Self.clamp((point.x - (hueRect.minX + thumbInset)) / span)
    case .alpha:
      let span = max(1, alphaRect.width - thumbInset * 2)
      colorAlpha = Self.clamp((point.x - (alphaRect.minX + thumbInset)) / span)
    case nil:
      return
    }
    if hue != oldH || saturation != oldS || brightness != oldB || colorAlpha != oldA {
      needsDisplay = true
    }
  }

  override func resetCursorRects() {
    addCursorRect(spectrumRect, cursor: PointerRole.marquee.cursor)
    addCursorRect(hueRect, cursor: PointerRole.passive.cursor)
    addCursorRect(alphaRect, cursor: PointerRole.passive.cursor)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    drawSpectrumSquare(in: context)
    let stops: [CGFloat] = [0, 1.0 / 6, 2.0 / 6, 3.0 / 6, 4.0 / 6, 5.0 / 6, 1]
    let hueColors = stops.map { stop -> CGColor in
      let rgb = AnnotationIcons.hsbToSRGB(hue: stop, saturation: 1, brightness: 1)
      return NSColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 1).cgColor
    }
    drawCapsuleBar(
      in: hueRect, checkerboard: false, colors: hueColors, locations: stops, context: context)
    let rgb = AnnotationIcons.hsbToSRGB(hue: hue, saturation: saturation, brightness: brightness)
    let clearRGB = NSColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 0).cgColor
    let solidRGB = NSColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 1).cgColor
    drawCapsuleBar(
      in: alphaRect, checkerboard: true, colors: [clearRGB, solidRGB], locations: [0, 1],
      context: context)
    drawThumbs(rgb: rgb)
  }

  private func drawSpectrumSquare(in context: CGContext) {
    let rect = spectrumRect
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8).addClip()
    let pure = AnnotationIcons.hsbToSRGB(hue: hue, saturation: 1, brightness: 1)
    let white = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1).cgColor
    let hueColor = NSColor(srgbRed: pure.r, green: pure.g, blue: pure.b, alpha: 1).cgColor
    if let hGrad = CGGradient(
      colorsSpace: srgb, colors: [white, hueColor] as CFArray, locations: [0, 1])
    {
      context.drawLinearGradient(
        hGrad, start: CGPoint(x: rect.minX, y: rect.minY), end: CGPoint(x: rect.maxX, y: rect.minY),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }
    let clear = NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0).cgColor
    let black = NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 1).cgColor
    if let vGrad = CGGradient(
      colorsSpace: srgb, colors: [clear, black] as CFArray, locations: [0, 1])
    {
      context.drawLinearGradient(
        vGrad, start: CGPoint(x: rect.minX, y: rect.minY), end: CGPoint(x: rect.minX, y: rect.maxY),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }
    NSGraphicsContext.restoreGraphicsState()
    strokeRim(rect, radius: 8)
  }

  private func drawCapsuleBar(
    in rect: CGRect, checkerboard: Bool, colors: [CGColor], locations: [CGFloat],
    context: CGContext
  ) {
    let r = rect.height / 2
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r).addClip()
    if checkerboard { AnnotationIcons.drawCheckerboard(in: rect, cell: 4) }
    if let grad = CGGradient(colorsSpace: srgb, colors: colors as CFArray, locations: locations) {
      context.drawLinearGradient(
        grad, start: CGPoint(x: rect.minX, y: rect.midY), end: CGPoint(x: rect.maxX, y: rect.midY),
        options: [])
    }
    NSGraphicsContext.restoreGraphicsState()
    strokeRim(rect, radius: r)
  }

  private func strokeRim(_ rect: CGRect, radius: CGFloat) {
    let border = NSBezierPath(
      roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: max(0, radius - 0.5),
      yRadius: max(0, radius - 0.5))
    border.lineWidth = 1
    NSColor.labelColor.withAlphaComponent(0.16).setStroke()
    border.stroke()
  }

  private func drawThumbs(rgb: (r: Double, g: Double, b: Double)) {
    let spectrumPt = CGPoint(
      x: spectrumRect.minX + saturation * spectrumRect.width,
      y: spectrumRect.minY + (1 - brightness) * spectrumRect.height)
    drawThumb(
      at: spectrumPt, diameter: 12,
      fill: NSColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 1), checkerboard: false)
    let hPt = CGPoint(
      x: hueRect.minX + thumbInset + hue * max(1, hueRect.width - thumbInset * 2),
      y: hueRect.midY)
    let pure = AnnotationIcons.hsbToSRGB(hue: hue, saturation: 1, brightness: 1)
    drawThumb(
      at: hPt, diameter: 14,
      fill: NSColor(srgbRed: pure.r, green: pure.g, blue: pure.b, alpha: 1), checkerboard: false)
    let aPt = CGPoint(
      x: alphaRect.minX + thumbInset + colorAlpha * max(1, alphaRect.width - thumbInset * 2),
      y: alphaRect.midY)
    drawThumb(
      at: aPt, diameter: 14,
      fill: NSColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: colorAlpha),
      checkerboard: true)
  }

  private func drawThumb(at center: CGPoint, diameter: CGFloat, fill: NSColor, checkerboard: Bool) {
    let rect = CGRect(
      x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.38)
    shadow.shadowBlurRadius = 3
    shadow.shadowOffset = NSSize(width: 0, height: -1)
    shadow.set()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: rect).fill()
    NSGraphicsContext.restoreGraphicsState()

    let inner = rect.insetBy(dx: 2, dy: 2)
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(ovalIn: inner).addClip()
    if checkerboard { AnnotationIcons.drawCheckerboard(in: inner, cell: 3) }
    fill.setFill()
    inner.fill()
    NSGraphicsContext.restoreGraphicsState()

    let outer = NSBezierPath(ovalIn: rect.insetBy(dx: 0.3, dy: 0.3))
    outer.lineWidth = 0.6
    NSColor.black.withAlphaComponent(0.32).setStroke()
    outer.stroke()
  }

  private static func clamp(_ v: CGFloat) -> CGFloat { min(max(v, 0), 1) }

  private static func isClose(_ a: AnnotationRGBA, _ b: AnnotationRGBA) -> Bool {
    let eps = 1e-4
    return abs(a.red - b.red) < eps && abs(a.green - b.green) < eps
      && abs(a.blue - b.blue) < eps && abs(a.alpha - b.alpha) < eps
  }

  private static func srgbToHSB(r: Double, g: Double, b: Double) -> (
    h: CGFloat, s: CGFloat, b: CGFloat
  ) {
    let mx = max(r, max(g, b))
    let mn = min(r, min(g, b))
    let delta = mx - mn
    let bri = CGFloat(mx)
    let sat = mx > 0.0001 ? CGFloat(delta / mx) : 0
    var hue: CGFloat = 0
    if delta > 0.0001 {
      if mx == r {
        hue = CGFloat((g - b) / delta + (g < b ? 6 : 0)) / 6
      } else if mx == g {
        hue = CGFloat((b - r) / delta + 2) / 6
      } else {
        hue = CGFloat((r - g) / delta + 4) / 6
      }
    }
    return (hue, sat, bri)
  }
}
