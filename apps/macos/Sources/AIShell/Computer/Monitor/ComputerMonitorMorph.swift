import AppKit
import QuartzCore

/// Steps the focus transition on the display clock. Each step sets the moving picture's frame and
/// lays it out at once, so the video, which ``NativeVideoView`` fits only in its own layout pass
/// and without implicit animations, follows the picture on every frame. A Core Animation frame
/// animation would instead move the model frame to its end at once, and the video with it, which
/// is the jump the morph must not show.
final class ComputerMonitorMorph {
  /// The display link retains its target, so the target holds the morph weakly.
  private final class Target: NSObject {
    weak var morph: ComputerMonitorMorph?

    init(morph: ComputerMonitorMorph) { self.morph = morph }

    @objc func tick(_ link: CADisplayLink) { morph?.tick() }
  }

  private var link: CADisplayLink?
  private var started: CFTimeInterval = 0
  private var duration: CFTimeInterval = 0
  private var step: ((CGFloat) -> Void)?
  private var completion: (() -> Void)?

  isolated deinit { link?.invalidate() }

  var isRunning: Bool { link != nil }

  /// Calls `step` with the eased progress, from 0 to 1, on every frame of `view`'s display for
  /// `duration` seconds, then `completion`. A transition still running finishes first, and a view
  /// off screen, which no display drives, finishes at once.
  func run(
    on view: NSView, duration: CFTimeInterval, step: @escaping (CGFloat) -> Void,
    completion: @escaping () -> Void
  ) {
    finish()
    self.step = step
    self.completion = completion
    self.duration = duration
    started = CACurrentMediaTime()
    guard view.window != nil, duration > 0 else {
      complete()
      return
    }
    step(0)
    let link = view.displayLink(target: Target(morph: self), selector: #selector(Target.tick(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  /// Jumps a running transition to its end, so a new one starts from a settled layout.
  func finish() {
    guard link != nil else { return }
    complete()
  }

  private func tick() {
    let elapsed = (CACurrentMediaTime() - started) / duration
    guard elapsed < 1 else {
      complete()
      return
    }
    step?(Self.easeOut(elapsed))
  }

  private func complete() {
    link?.invalidate()
    link = nil
    let step = step
    let completion = completion
    self.step = nil
    self.completion = nil
    step?(1)
    completion?()
  }

  /// Cubic ease-out: quick to start, settling without overshoot.
  private static func easeOut(_ progress: Double) -> CGFloat {
    CGFloat(1 - pow(1 - progress, 3))
  }
}
