import AICore
import SwiftUI

/// Runs a body shape's change (``MiniPanelGlassRect``) with its thickness (x, width and corner,
/// for the mini panel's `horizontal` ``axis``) and its length (y, height) each on their own
/// spring after their own delay (``MiniPanelShapeMotion``); a `vertical` axis swaps them, so the
/// command island's height and corner take the thickness spring and its width the length's.
/// One animation over one vector, so the glass, its clip and the content following it are
/// interpolated together.
///
/// A change made while one runs merges into it (``shouldMerge(previous:value:time:context:)``):
/// the springs already running go on to the shapes they were going to, overshoot and all, and
/// the change of target runs on its own motion from that moment, added to them, which for springs
/// is retargeting them with their velocity, as SwiftUI's own springs are retargeted. SwiftUI's
/// combination of animations that do not merge would instead damp the overshoot of the springs
/// already running, measured: a card retargeted as it grows (a write offer arriving as it
/// enters) settled with no bounce at all.
///
/// The content gets the shape itself and moves per axis. `glassEffect(in:)` erases the shape it
/// is given, so the glass's change arrives as opaque data, which moves as a whole on the length's
/// spring; the clip takes the shape erased alike (``View/clippedGlass(in:clear:)``), so the
/// surface fill it bounds moves with the glass's rim rather than sliding off it per axis. Drawing
/// the glass from a per-axis shape every frame instead (an animatable modifier) costs about 1 ms
/// more of the main thread per frame, measured: SwiftUI interpolates the erased shape without
/// updating the view graph.
///
/// A change ends once it can no longer move anything by more than ``restTolerance`` (perf-v2):
/// SwiftUI's own estimate for a spring at rest runs a bouncy spring's sub-pixel tail, redrawing
/// the glass on every frame for a few hundred milliseconds after the last visible motion. The jump
/// to rest is under a pixel, so ending there cannot be seen.
nonisolated struct MiniPanelAxisAnimation: CustomAnimation {
  /// The most, in points, a shape's change still has to go when it ends: half a pixel on Retina.
  static let restTolerance = 0.25

  let motion: MiniPanelShapeMotion
  var axis = MiniPanelShapeAxis.horizontal

  func animate<V: VectorArithmetic>(
    value: V, time: TimeInterval, context: inout AnimationContext<V>
  ) -> V? {
    context.axisMoves.take(value, on: self)
    var moved = V.zero
    var moving = false
    for move in context.axisMoves.moves {
      if let part = move.animation.share(of: move.change, at: time - move.start) {
        moved += part
        moving = true
      } else {
        moved += move.change
      }
    }
    return moving ? moved : nil
  }

  /// Another shape change of this kind takes over the one running, which goes on inside it
  /// (``MiniPanelAxisMoves``); its first frame adds the change of target, from `time` on.
  func shouldMerge<V: VectorArithmetic>(
    previous: Animation, value: V, time: TimeInterval, context: inout AnimationContext<V>
  ) -> Bool {
    guard previous.base is Self, !context.axisMoves.moves.isEmpty else { return false }
    context.axisMoves.retargeted = time
    return true
  }

  /// How much of `change` this motion has moved `time` seconds into it; nil once it rests.
  func share<V: VectorArithmetic>(of change: V, at time: TimeInterval) -> V? {
    let (thickness, length) = (motion.thickness.spring, motion.length.spring)
    let across = Self.progress(thickness, after: motion.thicknessDelay, at: time)
    let along = Self.progress(length, after: motion.lengthDelay, at: time)
    // The glass's erased shape, or anything else in the scope, moves with the length as a whole,
    // its change in points at most its magnitude.
    guard let shape = change as? MiniPanelGlassRect else {
      let extent = change.magnitudeSquared.squareRoot()
      guard !Self.rests(length, after: motion.lengthDelay, change: extent, at: time) else {
        return nil
      }
      return change.scaled(by: along)
    }
    let extent = axis.extent(of: shape.components)
    guard !Self.rests(motion, across: extent.across, along: extent.along, at: time) else {
      return nil
    }
    let share = axis.progress(across: across, along: along)
    let moved = MiniPanelGlassRect(
      x: shape.x * share.x, y: shape.y * share.y, width: shape.width * share.width,
      height: shape.height * share.height, corner: shape.corner * share.corner)
    return moved as? V
  }

  /// How long `motion` takes to end for a change of `across` points across the edge and `along`
  /// points along it, as it runs on the body.
  static func restTime(_ motion: MiniPanelShapeMotion, across: Double, along: Double) -> Double {
    let step = 1.0 / 240
    var time = 0.0
    while time < motion.settles * 4, !rests(motion, across: across, along: along, at: time) {
      time += step
    }
    return time
  }

  /// Whether neither axis of `motion`, changing by `across` and `along` points, can move the
  /// shape by more than ``restTolerance`` from `time` on.
  private static func rests(
    _ motion: MiniPanelShapeMotion, across: Double, along: Double, at time: Double
  ) -> Bool {
    rests(motion.thickness.spring, after: motion.thicknessDelay, change: across, at: time)
      && rests(motion.length.spring, after: motion.lengthDelay, change: along, at: time)
  }

  /// The spring's remaining energy, its distance from rest and its speed over its frequency, which
  /// bounds every swing still to come, as a share of the change, against the tolerance.
  private static func rests(
    _ spring: Spring, after delay: Double, change: Double, at time: Double
  ) -> Bool {
    guard change > restTolerance else { return true }
    guard time > delay else { return false }
    let left = 1 - spring.value(target: 1.0, time: time - delay)
    let speed = spring.velocity(target: 1.0, time: time - delay) / (2 * .pi / spring.duration)
    return (left * left + speed * speed).squareRoot() * change <= restTolerance
  }

  /// How far along a unit change `spring` is `time` seconds in, once `delay` has passed.
  private static func progress(_ spring: Spring, after delay: Double, at time: Double) -> Double {
    time <= delay ? 0 : spring.value(target: 1.0, time: time - delay)
  }
}

/// The shape changes one ``MiniPanelAxisAnimation`` runs: the first, and one for each change of
/// target merged into it, each from when it was made, on its own motion. The value SwiftUI gives
/// the animation runs from where the first began to the latest target, and its time from the
/// first's start, so the moves add up to it.
nonisolated struct MiniPanelAxisMoves<Value: VectorArithmetic>: AnimationStateKey {
  struct Move {
    let change: Value
    let start: TimeInterval
    let animation: MiniPanelAxisAnimation
  }

  private(set) var moves: [Move] = []
  /// When another change took over, until its first frame adds the change of target.
  var retargeted: TimeInterval?

  static var defaultValue: Self { Self() }

  /// Takes `value`, the whole change so far, on `animation`'s motion: all of it on the first
  /// frame, and on the first frame after a merge whatever it adds to the moves already running.
  mutating func take(_ value: Value, on animation: MiniPanelAxisAnimation) {
    guard !moves.isEmpty else {
      moves = [Move(change: value, start: 0, animation: animation)]
      return
    }
    guard let start = retargeted else { return }
    retargeted = nil
    let running = moves.reduce(Value.zero) { $0 + $1.change }
    moves.append(Move(change: value - running, start: start, animation: animation))
  }
}

nonisolated extension AnimationContext {
  fileprivate var axisMoves: MiniPanelAxisMoves<Value> {
    get { state[MiniPanelAxisMoves<Value>.self] }
    set { state[MiniPanelAxisMoves<Value>.self] = newValue }
  }
}
