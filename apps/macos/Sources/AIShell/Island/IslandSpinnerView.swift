import AICore
import AppKit
import QuartzCore

/// The island's activity indicator (``IslandSpinnerStyle``): the system small spinner's spokes
/// and stepped clockwise wave, drawn with Core Animation in the label colour of its appearance.
/// The wave is one discrete keyframe animation of each spoke's opacity, offset spoke by spoke,
/// so it runs in the render server with nothing on the main thread. It runs only while its
/// window is at least partly visible; otherwise, and when it leaves its window, the spokes hold
/// a still frame of the wave. Under Reduce Motion the wave turns at half the pace, as a progress
/// indicator still has to show progress.
final class IslandSpinnerView: NSView {
  private typealias Style = IslandSpinnerStyle
  private static let fadeKey = "island.spinner.fade"

  private var spokes: [CALayer] = []
  /// The period of the wave that runs, if any.
  private var running: Double?
  private var observers: [(center: NotificationCenter, token: NSObjectProtocol)] = []

  init() {
    super.init(frame: NSRect(x: 0, y: 0, width: Style.side, height: Style.side))
    layer = CALayer()
    wantsLayer = true
    for _ in 0..<Style.spokes {
      let spoke = CALayer()
      spoke.cornerRadius = Style.spokeWidth / 2
      layer?.addSublayer(spoke)
      spokes.append(spoke)
    }
    holdStill()
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func layout() {
    super.layout()
    placeSpokes()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    var color = NSColor.labelColor.cgColor
    effectiveAppearance.performAsCurrentDrawingAppearance { color = NSColor.labelColor.cgColor }
    withoutActions { for spoke in spokes { spoke.backgroundColor = color } }
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
    syncWave()
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ object: Any?) {
    let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.syncWave() }
    }
    observers.append((center, token))
  }

  /// Each spoke from the inner radius to the edge, the first pointing up and the rest clockwise,
  /// in whichever direction the layer's geometry runs.
  private func placeSpokes() {
    guard let layer else { return }
    let flipped = layer.contentsAreFlipped()
    let center = CGPoint(x: bounds.midX, y: bounds.midY)
    withoutActions {
      for (index, spoke) in spokes.enumerated() {
        spoke.bounds = CGRect(x: 0, y: 0, width: Style.spokeWidth, height: Style.spokeLength)
        spoke.anchorPoint = CGPoint(x: 0.5, y: -Style.innerRadius / Style.spokeLength)
        spoke.position = center
        let turn = Double(index) / Double(Style.spokes) * 2 * .pi
        // Clockwise is a negative angle where y runs up, a positive one where it runs down.
        spoke.setAffineTransform(CGAffineTransform(rotationAngle: flipped ? turn : -turn))
      }
    }
  }

  /// Runs the wave while the window can be seen, at the pace Reduce Motion asks for; holds a
  /// still frame otherwise.
  private func syncWave() {
    let visible = window?.occlusionState.contains(.visible) == true
    guard visible else {
      running = nil
      for spoke in spokes { spoke.removeAnimation(forKey: Self.fadeKey) }
      return
    }
    let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let period = reduce ? Style.reducedPeriod : Style.period
    guard running != period else { return }
    running = period
    let values = Style.opacities()
    let delay = Style.spokeDelay(period: period)
    for (index, spoke) in spokes.enumerated() {
      let fade = CAKeyframeAnimation(keyPath: "opacity")
      fade.values = values
      // A discrete animation holds each value until the next key time, so it takes one more.
      fade.keyTimes = (0...values.count).map { NSNumber(value: Double($0) / Double(values.count)) }
      fade.calculationMode = .discrete
      fade.duration = period
      fade.repeatCount = .infinity
      // Each spoke a spoke's delay behind the one before it, so the wave turns clockwise.
      fade.timeOffset = (period - Double(index) * delay).truncatingRemainder(dividingBy: period)
      spoke.add(fade, forKey: Self.fadeKey)
    }
  }

  /// The wave's first frame, which shows whenever it does not run.
  private func holdStill() {
    let values = Style.opacities()
    let stride = values.count / Style.spokes
    withoutActions {
      for (index, spoke) in spokes.enumerated() {
        let step = (values.count - index * stride) % values.count
        spoke.opacity = Float(values[step])
      }
    }
  }

  private func withoutActions(_ body: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    body()
    CATransaction.commit()
  }
}
