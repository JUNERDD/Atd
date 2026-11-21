import UIKit

/// The slide between neighboring pages that `TabSwipe` drives: the page that shows leaves toward
/// the side the finger moves to and its neighbor follows it in from the other edge, 1:1 with the
/// finger. Released, the pages settle on a spring that picks up the finger's speed, without
/// overshooting the page's edge.
final class TabSlideTransition: NSObject, UIViewControllerAnimatedTransitioning,
  UIViewControllerInteractiveTransitioning
{
  /// -1 when the finger moves left, 1 when it moves right: the way both pages move.
  let direction: CGFloat
  private let ended: () -> Void
  private var context: (any UIViewControllerContextTransitioning)?
  private var animator: UIViewPropertyAnimator?
  private var progress: CGFloat = 0
  /// A release that came before UIKit started the slide, applied once it starts.
  private var pendingRelease: (landing: Bool, speed: CGFloat)?
  /// Whether the finger has let go and the pages are settling.
  private var isSettling = false

  /// The spring the pages settle on, critically damped. Its natural frequency bounds the speed it
  /// can take from the finger without overshooting (`release(landing:speed:)`).
  private static let stiffness: CGFloat = 300
  private static var frequency: CGFloat { stiffness.squareRoot() }

  init(direction: CGFloat, ended: @escaping () -> Void) {
    self.direction = direction
    self.ended = ended
  }

  /// Whether UIKit has started the slide.
  var hasStarted: Bool { context != nil }

  func transitionDuration(using context: (any UIViewControllerContextTransitioning)?)
    -> TimeInterval
  {
    0.35
  }

  /// Plays the slide straight through. UIKit calls this only for a slide without an interaction,
  /// which `TabSwipe` never starts; the protocol requires it.
  func animateTransition(using context: any UIViewControllerContextTransitioning) {
    start(context)
    animator?.startAnimation()
  }

  func startInteractiveTransition(_ context: any UIViewControllerContextTransitioning) {
    start(context)
    update(progress: progress)
    if let pendingRelease { release(landing: pendingRelease.landing, speed: pendingRelease.speed) }
  }

  /// Moves the pages to `progress` of the way, 0 showing the page the swipe started on.
  func update(progress: CGFloat) {
    self.progress = min(max(progress, 0), 1)
    guard let context, let animator else { return }
    animator.fractionComplete = self.progress
    context.updateInteractiveTransition(self.progress)
  }

  /// Settles the pages on the neighbor when `landing`, back where they started otherwise, carrying
  /// on at `speed`, the finger's speed in points per second the way the pages move.
  func release(landing: Bool, speed: CGFloat) {
    guard let context, let animator else {
      pendingRelease = (landing, speed)
      return
    }
    if landing {
      context.finishInteractiveTransition()
    } else {
      context.cancelInteractiveTransition()
    }
    animator.isReversed = !landing
    let remaining = (landing ? 1 - progress : progress) * context.containerView.bounds.width
    // The spring's speed is in remaining distances per second, toward where the pages settle.
    let toward = landing ? speed : -speed
    let initial = remaining > 1 ? min(max(toward / remaining, 0), Self.frequency) : 0
    let spring = UISpringTimingParameters(
      mass: 1, stiffness: Self.stiffness, damping: 2 * Self.frequency,
      initialVelocity: CGVector(dx: initial, dy: 0))
    animator.continueAnimation(withTimingParameters: spring, durationFactor: 1)
    isSettling = true
  }

  /// Ends a settling slide at once where it was going, for a swipe that takes over from it.
  func settleNow() {
    guard isSettling, let animator else { return }
    animator.stopAnimation(false)
    animator.finishAnimation(at: animator.isReversed ? .start : .end)
  }

  private func start(_ context: any UIViewControllerContextTransitioning) {
    self.context = context
    guard let from = context.view(forKey: .from), let to = context.view(forKey: .to),
      let incoming = context.viewController(forKey: .to)
    else {
      context.completeTransition(!context.transitionWasCancelled)
      ended()
      return
    }
    let width = context.containerView.bounds.width
    let direction = direction
    to.frame = context.finalFrame(for: incoming)
    to.transform = CGAffineTransform(translationX: -direction * width, y: 0)
    context.containerView.addSubview(to)
    let animator = UIViewPropertyAnimator(duration: 0.35, dampingRatio: 1) {
      from.transform = CGAffineTransform(translationX: direction * width, y: 0)
      to.transform = .identity
    }
    animator.addCompletion { [ended] position in
      from.transform = .identity
      to.transform = .identity
      let landed = position == .end
      if !landed { to.removeFromSuperview() }
      context.completeTransition(landed)
      ended()
    }
    animator.pauseAnimation()
    self.animator = animator
  }
}
