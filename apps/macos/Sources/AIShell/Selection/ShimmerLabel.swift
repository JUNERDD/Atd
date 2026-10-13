import AICore
import AppKit
import QuartzCore

/// A one-line label for running text, with the page's shimmer (``ShimmerSweep``): the text in
/// the secondary label colour, and a label-colour band sweeping across its glyphs.
///
/// It stays an ordinary text field, so layout, truncation, its tooltip and what VoiceOver reads
/// (the plain string) are the field's own. Over it lies a layer-hosting overlay that takes no
/// clicks and is not an accessibility element: a gradient layer masked by an image of the glyphs
/// as the field draws them, so the band follows the truncated, rendered text, and the sweep is
/// the page's, sized to that ink and the characters it shows (``ShimmerSweep``). The sweep is a Core Animation animation of the
/// gradient's position, so it runs on the render server; the main thread only redraws the mask
/// (and measures the ink) when the size, text or scale changes.
///
/// The sweep runs only while the label is in a window that is at least partly visible and
/// Reduce Motion is off; otherwise the overlay is hidden and its animation removed, leaving the
/// static muted text the page shows under reduced motion. Leaving the window (the row replaced,
/// the HUD hidden) or the window leaving the screen stops it. The band's colour is resolved again
/// whenever the appearance changes; the muted text colour is dynamic already.
final class ShimmerLabel: NSTextField {
  private static let sweepKey = "shimmer.sweep"

  private let overlay = Overlay()
  /// What the glyph mask and the running animation were made for.
  private var masked: MaskKey?
  /// The horizontal extent of the drawn glyphs, in points, as the mask last found it.
  private var ink: ClosedRange<Double>?
  private var animated: Animated?
  private var observers: [(center: NotificationCenter, token: NSObjectProtocol)] = []

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    addSubview(overlay)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// A label of `string` in `font`, in the secondary label colour.
  convenience init(running string: String, font: NSFont) {
    self.init(labelWithString: string)
    self.font = font
    textColor = .secondaryLabelColor
  }

  override var stringValue: String {
    didSet { needsLayout = true }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    refresh()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    needsLayout = true
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    var color = NSColor.labelColor.cgColor
    effectiveAppearance.performAsCurrentDrawingAppearance { color = NSColor.labelColor.cgColor }
    overlay.tint(color)
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    for observer in observers { observer.center.removeObserver(observer.token) }
    observers = []
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let window {
      observe(NotificationCenter.default, NSWindow.didChangeOcclusionStateNotification, window)
      observe(
        NSWorkspace.shared.notificationCenter,
        NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, nil)
    }
    viewDidChangeEffectiveAppearance()
    needsLayout = true
    syncSweep()
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ object: Any?) {
    let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.syncSweep() }
    }
    observers.append((center, token))
  }

  /// Draws the glyph mask again when what it shows changed, then brings the sweep in line.
  private func refresh() {
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    let key = MaskKey(size: bounds.size, text: stringValue, scale: scale)
    if key != masked {
      masked = key
      overlay.frame = bounds
      let drawn = glyphs(scale: scale)
      ink = drawn?.ink
      overlay.mask(drawn?.image, scale: scale)
    }
    syncSweep()
  }

  /// Runs the sweep while it can be seen and motion is welcome; removes it otherwise.
  private func syncSweep() {
    let visible = window?.occlusionState.contains(.visible) == true
    let sweep = ink.flatMap { ink in
      ShimmerSweep(
        inkMinX: ink.lowerBound, inkMaxX: ink.upperBound,
        characters: ShimmerSweep.shownCharacters(
          ShimmerSweep.characters(in: stringValue), shownWidth: ink.upperBound - ink.lowerBound,
          fullWidth: attributedStringValue.size().width))
    }
    guard visible, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, let sweep else {
      animated = nil
      overlay.stop(Self.sweepKey)
      return
    }
    let next = Animated(sweep: sweep, height: bounds.height)
    guard next != animated || !overlay.isRunning(Self.sweepKey) else { return }
    animated = next
    overlay.run(sweep, height: bounds.height, key: Self.sweepKey)
  }

  /// The glyphs as this field draws them (same font, truncation and inset), opaque wherever
  /// there is ink: drawn by a copy of the cell in black, so the mask's alpha is the glyphs'
  /// coverage rather than the muted colour's. Also returns where that ink starts and ends.
  private func glyphs(scale: CGFloat) -> (image: CGImage?, ink: ClosedRange<Double>?)? {
    guard bounds.width >= 1, bounds.height >= 1,
      let cell = cell?.copy() as? NSTextFieldCell,
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int((bounds.width * scale).rounded(.up)),
        pixelsHigh: Int((bounds.height * scale).rounded(.up)), bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0),
      let bitmap = NSGraphicsContext(bitmapImageRep: rep)
    else { return nil }
    rep.size = bounds.size
    cell.textColor = .black
    let context = bitmap.cgContext
    context.scaleBy(x: scale, y: scale)
    if isFlipped {
      context.translateBy(x: 0, y: bounds.height)
      context.scaleBy(x: 1, y: -1)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: isFlipped)
    cell.drawInterior(withFrame: bounds, in: self)
    NSGraphicsContext.restoreGraphicsState()
    return (rep.cgImage, Self.inkColumns(of: rep, scale: scale))
  }

  /// The first and last pixel columns holding ink in `rep` (non-planar RGBA, alpha last), in
  /// points; nil when nothing was drawn. Faint antialiasing below the threshold does not count.
  private static func inkColumns(of rep: NSBitmapImageRep, scale: CGFloat) -> ClosedRange<Double>? {
    guard let data = rep.bitmapData, rep.samplesPerPixel == 4 else { return nil }
    let row = rep.bytesPerRow
    var first: Int?
    var last: Int?
    for x in 0..<rep.pixelsWide {
      var inked = false
      for y in 0..<rep.pixelsHigh where data[y * row + x * 4 + 3] > 24 {
        inked = true
        break
      }
      guard inked else { continue }
      if first == nil { first = x }
      last = x
    }
    guard let first, let last else { return nil }
    return Double(first) / scale...Double(last + 1) / scale
  }

  private struct MaskKey: Equatable {
    let size: NSSize
    let text: String
    let scale: CGFloat
  }

  private struct Animated: Equatable {
    let sweep: ShimmerSweep
    let height: CGFloat
  }
}

/// The highlight over a ``ShimmerLabel``: its own layer (a layer-hosting view) holds the moving
/// gradient and is masked by the glyph image.
private final class Overlay: NSView {
  private let band = CAGradientLayer()
  private let glyphs = CALayer()

  init() {
    super.init(frame: .zero)
    layer = CALayer()
    wantsLayer = true
    band.startPoint = CGPoint(x: 0, y: 0.5)
    band.endPoint = CGPoint(x: 1, y: 0.5)
    layer?.addSublayer(band)
    layer?.mask = glyphs
    isHidden = true
    setAccessibilityElement(false)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// Decorative only: clicks, drags and tooltips belong to the label beneath.
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// The band in `color`, fading to transparent on both sides.
  func tint(_ color: CGColor) {
    let clear = color.copy(alpha: 0) ?? .clear
    withoutActions { band.colors = [clear, color, clear] }
  }

  /// Masks the band to `image`. AppKit may flip this layer's geometry an odd number of times
  /// on the way up (``CALayer/contentsAreFlipped()``), which would render the image upside
  /// down; the mask is mirrored back then.
  func mask(_ image: CGImage?, scale: CGFloat) {
    withoutActions {
      glyphs.frame = bounds
      glyphs.contents = image
      glyphs.contentsScale = scale
      glyphs.contentsGravity = .resize
      let flipped = band.contentsAreFlipped()
      glyphs.setAffineTransform(flipped ? CGAffineTransform(scaleX: 1, y: -1) : .identity)
    }
  }

  func isRunning(_ key: String) -> Bool { band.animation(forKey: key) != nil }

  /// Places the band for `sweep` over text `height` points tall and sweeps it without end.
  func run(_ sweep: ShimmerSweep, height: CGFloat, key: String) {
    withoutActions {
      band.locations = ShimmerSweep.locations.map { NSNumber(value: $0) }
      band.bounds = CGRect(x: 0, y: 0, width: sweep.bandWidth, height: height)
      band.position = CGPoint(x: sweep.startCenter, y: height / 2)
    }
    let move = CABasicAnimation(keyPath: "position.x")
    move.fromValue = sweep.startCenter
    move.toValue = sweep.endCenter
    move.duration = ShimmerSweep.duration
    move.timingFunction = CAMediaTimingFunction(name: .linear)
    move.repeatCount = .infinity
    // Started as far back as the shared clock's phase, so a sweep added again carries on where
    // the band was rather than jumping back to the leading edge (``ShimmerSweep/phase(at:)``).
    let now = CACurrentMediaTime()
    move.beginTime = band.convertTime(now, from: nil) - ShimmerSweep.phase(at: now)
    band.add(move, forKey: key)
    isHidden = false
  }

  func stop(_ key: String) {
    band.removeAnimation(forKey: key)
    isHidden = true
  }

  private func withoutActions(_ body: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    body()
    CATransaction.commit()
  }
}
