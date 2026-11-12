import AppKit

/// The bar under a text command's button while the command runs (the plan's prototype): a 2 pt
/// accent track with a brighter band sweeping across it every 1.2 s, the button's label left as it
/// is. With Reduce Motion the band stays still at the track's start. It never takes the mouse.
final class AnnotationRunBar: NSView {
  static let sweepDuration: CFTimeInterval = 1.2

  private let band = CAGradientLayer()
  /// The width the sweep runs across; a new one restarts it.
  private var sweptWidth: CGFloat = 0

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.cornerRadius = 1
    layer?.masksToBounds = true
    band.startPoint = CGPoint(x: 0, y: 0.5)
    band.endPoint = CGPoint(x: 1, y: 0.5)
    layer?.addSublayer(band)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var wantsUpdateLayer: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func updateLayer() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let accent = NSColor.controlAccentColor
      layer?.backgroundColor = accent.withAlphaComponent(0.22).cgColor
      band.colors = [accent.withAlphaComponent(0), accent, accent.withAlphaComponent(0)].map(
        \.cgColor)
    }
  }

  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    band.frame = CGRect(x: 0, y: 0, width: bounds.width * 0.4, height: bounds.height)
    CATransaction.commit()
    if !isHidden, bounds.width != sweptWidth { animate() }
  }

  func start() {
    isHidden = false
    needsLayout = true
    animate()
  }

  func stop() {
    isHidden = true
    band.removeAllAnimations()
  }

  private func animate() {
    band.removeAllAnimations()
    sweptWidth = bounds.width
    let width = band.bounds.width
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, bounds.width > 0 else {
      band.position = CGPoint(x: width / 2, y: bounds.midY)
      return
    }
    let sweep = CABasicAnimation(keyPath: "position.x")
    sweep.fromValue = -width / 2
    sweep.toValue = bounds.width + width / 2
    sweep.duration = Self.sweepDuration
    sweep.repeatCount = .infinity
    band.add(sweep, forKey: "sweep")
  }
}
