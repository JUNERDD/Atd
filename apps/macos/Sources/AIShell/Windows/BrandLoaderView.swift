import AppKit
import QuartzCore

/// The brand loader drawn natively, for the placeholder a page window shows until its page paints
/// (`apps/desktop/src/components/brand-loader.tsx`): the mark's two drops twine on the keyframes
/// ``BrandLoaderMotion`` shares with the page. Under Reduce Motion the mark rests whole and breathes
/// its opacity, as the page's does. Decorative: the placeholder's title names the state.
final class BrandLoaderView: NSView {
  private typealias Motion = BrandLoaderMotion

  /// Each drop nests three layers so every keyframe channel interpolates on its own, as CSS
  /// interpolates `translate() rotate() scale()` argument by argument: the outer layer moves and
  /// fades, the middle one scales and the inner one, the drop's shape, turns.
  private struct Drop {
    let move = CALayer()
    let scale = CALayer()
    let shape = CAShapeLayer()

    var layers: [CALayer] { [move, scale, shape] }
  }

  private let mark = CALayer()
  private let drops = [Drop(), Drop()]

  /// Y points down, as it does in the keyframes and on the page.
  override var isFlipped: Bool { true }

  override var intrinsicContentSize: NSSize {
    NSSize(width: Motion.boxSize, height: Motion.boxSize)
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    setAccessibilityElement(false)
    let inset = (Motion.boxSize - Motion.markSize) / 2
    mark.frame = CGRect(x: inset, y: inset, width: Motion.markSize, height: Motion.markSize)
    let bounds = CGRect(x: 0, y: 0, width: Motion.dropSize, height: Motion.dropSize)
    let middle = CGPoint(x: bounds.midX, y: bounds.midY)
    for drop in drops {
      for layer in drop.layers {
        layer.bounds = bounds
      }
      drop.scale.position = middle
      drop.shape.position = middle
      drop.shape.path = Self.dropPath(size: Motion.dropSize)
      drop.scale.addSublayer(drop.shape)
      drop.move.addSublayer(drop.scale)
      mark.addSublayer(drop.move)
    }
    layer?.addSublayer(mark)
    rest()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    for drop in drops {
      drop.shape.contentsScale = scale
    }
  }

  func setColor(_ color: CGColor) {
    for drop in drops {
      drop.shape.fillColor = color
    }
  }

  /// Starts the motion from the mark at rest, or stops it there.
  func setAnimating(_ animating: Bool) {
    mark.removeAllAnimations()
    for drop in drops {
      for layer in drop.layers {
        layer.removeAllAnimations()
      }
    }
    guard animating else { return }
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      breathe()
    } else {
      twine()
    }
  }

  /// The mark at rest: drop `a` upper left with its tip at the centre, `b` its point reflection.
  private func rest() {
    let first = Motion.keyframes[0]
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (drop, sign) in zip(drops, [1.0, -1.0]) {
      drop.move.position = point(x: sign * first.x, y: sign * first.y)
      drop.move.opacity = Float(first.opacity)
      drop.scale.transform = CATransform3DMakeScale(first.scale, first.scale, 1)
      let rotation = first.rotation + (sign < 0 ? 180 : 0)
      drop.shape.transform = CATransform3DMakeRotation(rotation * .pi / 180, 0, 0, 1)
    }
    CATransaction.commit()
  }

  /// Both drops play drop `a`'s keyframes; `b` runs a cycle of the rhythm ahead, where `a` stands
  /// in `b`'s place, as the page delays it by the same cycle.
  private func twine() {
    let keyframes = Motion.keyframes
    let times = keyframes.map { NSNumber(value: $0.time) }
    for (index, drop) in drops.enumerated() {
      let channels: [(CALayer, String, [Any])] = [
        (drop.move, "position", keyframes.map { NSValue(point: point(x: $0.x, y: $0.y)) }),
        (drop.move, "opacity", keyframes.map(\.opacity)),
        (drop.scale, "transform.scale", keyframes.map(\.scale)),
        (drop.shape, "transform.rotation.z", keyframes.map { $0.rotation * .pi / 180 }),
      ]
      for (layer, keyPath, values) in channels {
        let animation = CAKeyframeAnimation(keyPath: keyPath)
        animation.values = values
        animation.keyTimes = times
        animation.calculationMode = .linear
        animation.duration = Motion.duration
        animation.timeOffset = index == 0 ? 0 : Motion.bDelay
        animation.repeatCount = .infinity
        animation.isRemovedOnCompletion = false
        layer.add(animation, forKey: keyPath)
      }
    }
  }

  /// Reduce Motion: the resting mark breathes between full and 60% opacity on a sine, which never
  /// pauses at either end.
  private func breathe() {
    let breath = CABasicAnimation(keyPath: "opacity")
    breath.fromValue = 1.0
    breath.toValue = 0.6
    breath.duration = 1
    breath.autoreverses = true
    breath.repeatCount = .infinity
    breath.timingFunction = CAMediaTimingFunction(controlPoints: 0.37, 0, 0.63, 1)
    breath.isRemovedOnCompletion = false
    mark.add(breath, forKey: "opacity")
  }

  /// A drop's centre in the mark, from its offset from the mark's centre.
  private func point(x: Double, y: Double) -> CGPoint {
    CGPoint(x: Motion.markSize / 2 + x, y: Motion.markSize / 2 + y)
  }

  /// One drop in its square, y down: a circle filling the square with its lower-right quadrant
  /// squared off, so the tip is the square's corner (`symbol.svg`).
  private static func dropPath(size: Double) -> CGPath {
    let radius = size / 2
    let path = CGMutablePath()
    path.move(to: CGPoint(x: size, y: size))
    path.addLine(to: CGPoint(x: radius, y: size))
    path.addArc(
      center: CGPoint(x: radius, y: radius), radius: radius, startAngle: .pi / 2, endAngle: 0,
      clockwise: false)
    path.closeSubpath()
    return path
  }
}
