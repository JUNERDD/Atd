import AppKit
import QuartzCore

/// The bar under a text command's button while the command runs: a 2 pt accent track with a
/// periodic raised-cosine wave crest tiled across it and sweeping left to right every
/// ``sweepDuration`` seconds along a non-zero-floor periodic sine velocity curve on a shared
/// monotonic phase, so loops and relayouts never stall or jump. When Reduce Motion is enabled,
/// Glow Effects are off, or the window is occluded, the animation stops with the crest centered on
/// the track. It never takes the mouse.
final class AnnotationRunBar: NSView {
  static let sweepDuration: CFTimeInterval = 1.35
  private static let sweepKey = "capture.runBar.sweep"
  private static let minPeriod: CGFloat = 44
  private static let maxPeriod: CGFloat = 180

  /// Velocity modulation depth `a` in `u(t) = t - (a / 2π) sin(2πt)`: speed varies smoothly
  /// between `1 - a` (0.52×) during edge handoff and `1 + a` (1.48×) across the button's center.
  private static let velocityModulation = 0.48
  private static let curveSteps = 32

  /// Normalized periodic displacement `u(t)` in `[0, 1]` with `u'(0) == u'(1) > 0` and
  /// `u''(0) == u''(1) == 0`.
  private static let unitCurve: [Double] = (0...curveSteps).map { step in
    let t = Double(step) / Double(curveSteps)
    return t - (velocityModulation / (2 * .pi)) * sin(2 * .pi * t)
  }

  /// Spatial period of one crest in points, exceeding short button widths so adjacent peaks do not
  /// crowd both ends simultaneously while keeping the incoming crest entering as the outgoing leaves.
  static func period(for width: CGFloat) -> CGFloat {
    min(max(width * 1.28, minPeriod), maxPeriod)
  }

  /// Nine smooth raised-cosine stops (~36% valley, focused ~32% FWHM crest, zero value and slope
  /// across the outer margins so adjacent tiles join invisibly).
  private static let stops: [(location: Double, alpha: CGFloat)] = [
    (0.00, 0.00),
    (0.18, 0.00),
    (0.28, 0.18),
    (0.39, 0.68),
    (0.50, 1.00),
    (0.61, 0.68),
    (0.72, 0.18),
    (0.82, 0.00),
    (1.00, 0.00),
  ]

  private static let plainAppearances: [NSAppearance.Name] = [
    .aqua,
    .darkAqua,
    .accessibilityHighContrastAqua,
    .accessibilityHighContrastDarkAqua,
  ]

  private let track = CALayer()
  private let ribbon = CAReplicatorLayer()
  private let band = CAGradientLayer()
  private var active = false
  private var configured: LayoutSpec?
  private var animated: SweepSpec?
  private var observers: [(center: NotificationCenter, token: NSObjectProtocol)] = []

  private struct LayoutSpec: Equatable {
    let width: CGFloat
    let period: CGFloat
    let height: CGFloat
    let count: Int
    let restX: CGFloat
  }

  private struct SweepSpec: Equatable {
    let startX: CGFloat
    let period: CGFloat
  }

  override init(frame: NSRect) {
    super.init(frame: frame)
    let root = CALayer()
    layer = root
    wantsLayer = true
    clipsToBounds = true
    track.anchorPoint = .zero
    track.cornerRadius = 1
    track.masksToBounds = true
    ribbon.anchorPoint = .zero
    band.anchorPoint = .zero
    band.startPoint = CGPoint(x: 0, y: 0.5)
    band.endPoint = CGPoint(x: 1, y: 0.5)
    band.locations = Self.stops.map { NSNumber(value: $0.location) }
    ribbon.addSublayer(band)
    track.addSublayer(ribbon)
    root.addSublayer(track)
    setAccessibilityElement(false)
    updateColors()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var allowsVibrancy: Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    sync()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateColors()
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
      observe(NotificationCenter.default, GlowEffects.didChange, nil)
    }
    updateColors()
    sync()
  }

  func start() {
    active = true
    isHidden = false
    needsLayout = true
    sync()
  }

  func stop() {
    active = false
    isHidden = true
    animated = nil
    ribbon.removeAnimation(forKey: Self.sweepKey)
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ object: Any?) {
    let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.sync() }
    }
    observers.append((center, token))
  }

  private func updateColors() {
    let plain =
      effectiveAppearance.bestMatch(from: Self.plainAppearances).flatMap(NSAppearance.init(named:))
      ?? effectiveAppearance
    var trackColor = NSColor.clear.cgColor
    var gradient: [CGColor] = []
    plain.performAsCurrentDrawingAppearance {
      let accent = NSColor.controlAccentColor
      trackColor = accent.withAlphaComponent(0.22).cgColor
      gradient = Self.stops.map { accent.withAlphaComponent($0.alpha).cgColor }
    }
    withoutActions {
      track.backgroundColor = trackColor
      band.colors = gradient
    }
  }

  private func sync() {
    let width = bounds.width
    let height = bounds.height
    guard active, !isHidden, width > 0, height > 0 else {
      animated = nil
      ribbon.removeAnimation(forKey: Self.sweepKey)
      return
    }
    let period = Self.period(for: width)
    let lead = Int(ceil((0.5 * width) / period))
    let endX = 0.5 * width - CGFloat(lead) * period
    let startX = endX - period
    let restX = 0.5 * (startX + endX)
    let count = Int(ceil((width - startX) / period)) + 1
    let spec = LayoutSpec(width: width, period: period, height: height, count: count, restX: restX)
    if spec != configured {
      configured = spec
      withoutActions {
        track.bounds = CGRect(x: 0, y: 0, width: width, height: height)
        track.position = .zero
        track.cornerRadius = height / 2
        track.masksToBounds = true
        ribbon.bounds = CGRect(x: 0, y: 0, width: period * CGFloat(count), height: height)
        ribbon.position = CGPoint(x: restX, y: 0)
        ribbon.instanceCount = count
        ribbon.instanceTransform = CATransform3DMakeTranslation(period, 0, 0)
        band.bounds = CGRect(x: 0, y: 0, width: period, height: height)
        band.position = .zero
      }
    }
    let visible = window?.occlusionState.contains(.visible) == true
    guard visible, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
      GlowEffects.shared.enabled
    else {
      animated = nil
      ribbon.removeAnimation(forKey: Self.sweepKey)
      return
    }
    let sweepSpec = SweepSpec(startX: startX, period: period)
    guard sweepSpec != animated || ribbon.animation(forKey: Self.sweepKey) == nil else { return }
    animated = sweepSpec
    let sweep = CAKeyframeAnimation(keyPath: "position.x")
    sweep.values = Self.unitCurve.map { Double(startX) + Double(period) * $0 }
    sweep.keyTimes = (0...Self.curveSteps).map {
      NSNumber(value: Double($0) / Double(Self.curveSteps))
    }
    sweep.calculationMode = .linear
    sweep.duration = Self.sweepDuration
    sweep.repeatCount = .infinity
    sweep.isRemovedOnCompletion = false
    let now = CACurrentMediaTime()
    let phase = now.truncatingRemainder(dividingBy: Self.sweepDuration)
    sweep.beginTime =
      ribbon.convertTime(now, from: nil) - (phase < 0 ? phase + Self.sweepDuration : phase)
    ribbon.add(sweep, forKey: Self.sweepKey)
  }

  private func withoutActions(_ body: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    body()
    CATransaction.commit()
  }
}
