import AppKit
import SwiftUI

/// One clock owns the window and its coordinate compensation. The current shift is rendered
/// without a second SwiftUI spring and is also the position used by hit testing and re-dragging.
struct MiniPanelSnapMotion {
  static let limit = 3.0

  private let spring: Spring
  private var value: AnimatablePair<Double, Double>
  private var velocity: AnimatablePair<Double, Double>
  private let rest: AnimatablePair<Double, Double>
  private var compensation: AnimatablePair<Double, Double>
  private var compensationVelocity = AnimatablePair(0.0, 0.0)
  private var pendingRelease: CGVector?
  let startedAt: Double
  private var elapsed = 0.0
  private(set) var frames = 0
  private(set) var longestFrame = 0.0

  init(
    spring: Spring, origin: CGPoint, velocity: CGVector, shift: CGSize,
    rest: CGPoint, at start: Double, releaseBody: Bool = false
  ) {
    self.spring = spring
    value = AnimatablePair(origin.x, origin.y)
    self.velocity = AnimatablePair(velocity.dx, velocity.dy)
    compensation = AnimatablePair(shift.width, shift.height)
    self.rest = AnimatablePair(rest.x, rest.y)
    startedAt = start
    pendingRelease = releaseBody ? velocity : nil
  }

  var origin: CGPoint { CGPoint(x: value.first, y: value.second) }
  var shift: CGSize { CGSize(width: compensation.first, height: compensation.second) }

  /// Keep lift/stretch changes out of the coordinate-rebase update. No detached callback can
  /// later change a new drag: cancelling this motion cancels this pending release too.
  mutating func takeBodyRelease() -> CGVector? {
    guard frames >= 2 else { return nil }
    defer { pendingRelease = nil }
    return pendingRelease
  }

  mutating func step(_ delta: Double) -> Bool {
    elapsed += delta
    frames += 1
    longestFrame = max(longestFrame, delta)
    if frames == 1, pendingRelease != nil { return false }
    spring.update(value: &value, velocity: &velocity, target: rest, deltaTime: delta)
    spring.update(
      value: &compensation, velocity: &compensationVelocity,
      target: AnimatablePair(0.0, 0.0), deltaTime: delta)
    let resting =
      (value - rest).magnitudeSquared < 0.25 && velocity.magnitudeSquared < 64
      && compensation.magnitudeSquared < 0.25 && compensationVelocity.magnitudeSquared < 64
    guard resting || elapsed >= Self.limit else { return false }
    value = rest
    compensation = AnimatablePair(0.0, 0.0)
    return true
  }
}
