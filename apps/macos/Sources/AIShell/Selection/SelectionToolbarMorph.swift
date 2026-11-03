import AICore
import AppKit
import QuartzCore
import SwiftUI

/// The small icon (``SelectionToolbarSmallIcon``) growing into the selection toolbar as the mini
/// panel's pill opens into its capsule and the command island goes from shape to shape
/// (``MiniPanelChoreography``'s expand, island-v1): one glass shape stretching from the icon's
/// circle into the toolbar's capsule, its height on the thickness spring and its width on the
/// length's (the island's axes, ``MiniPanelShapeAxis/vertical``), swelling a little past its rest
/// before it settles. The icon's face leaves at once, eased in over the content's exit, and the
/// row arrives once it has gone, on the content's opacity spring. Both ride centred in the shape
/// and scale with it as the island's content does (``MiniPanelFollowEffect``), up to
/// ``MiniPanelChoreography/followLimit``, the row clipped by the glass. Neither blurs as the
/// island's content does: an AppKit view blurs only through Core Image layer filters, which
/// render in the app's process. Reduce Motion takes the bounce out of the springs and keeps the
/// face and the row at their own size, revealed by the glass.
///
/// The toolbar is AppKit glass, so this steps on the display's frames what SwiftUI interpolates
/// for the island (``MiniPanelAxisAnimation``): the glass's outline with the row's scale and
/// opacity (``AnnotationGlassBar/outline``), and the face. Clicks and hover go by the row's rest
/// layout throughout, so a click before it has settled acts on what settles under the pointer.
/// It ends once everything has come to rest, or at once with ``stop()``.
@MainActor
final class SelectionToolbarMorph: NSObject {
  /// The icon's face leaves as the mini panel's content does when its shape opens…
  private static let leaving = MiniPanelChoreography.content(.expand)
  /// …and the row arrives once it has gone, as content replacing content does there.
  private static let arrival = max(leaving.delay, leaving.exit)

  private weak var bar: AnnotationGlassBar?
  /// The toolbar's capsule at rest and the icon's circle, in the bar.
  private let rest: NSRect
  private let icon: NSRect
  private let motion: MiniPanelShapeMotion
  /// Whether the face and the row scale with the shape (not under Reduce Motion).
  private let scales: Bool
  /// When the shape and the row have both come to rest, in seconds from the start.
  private let ends: Double
  private let faceView = PassiveImageView()
  private var start: CFTimeInterval = 0
  private var link: CADisplayLink?

  /// Sizes `bar` at its rest size `rest` and gives its glass the icon's circle `icon` (in the
  /// bar), with `face`, the icon's look, on it, before the bar shows.
  init(bar: AnnotationGlassBar, rest: NSSize, icon: NSRect, face: NSImage?) {
    let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    self.bar = bar
    self.rest = NSRect(origin: .zero, size: rest)
    self.icon = icon
    motion = MiniPanelChoreography.shape(.expand, reduceMotion: reduceMotion)
    scales = !reduceMotion
    let change = MiniPanelShapeAxis.vertical.extent(
      of: .init(
        x: -icon.minX, y: -icon.minY, width: rest.width - icon.width,
        height: rest.height - icon.height, corner: (rest.height - icon.height) / 2))
    ends = max(
      MiniPanelAxisAnimation.restTime(motion, across: change.across, along: change.along),
      Self.arrival + MiniPanelMotion.settling(MiniPanelChoreography.contentOpacity))
    super.init()
    faceView.image = face
    faceView.imageScaling = .scaleProportionallyUpOrDown
    faceView.setAccessibilityElement(false)
    bar.frame = self.rest
    bar.addSubview(faceView)
    step(0)
  }

  /// Runs the change on `view`'s display frames, from now.
  func run(in view: NSView) {
    start = CACurrentMediaTime()
    let link = view.displayLink(target: self, selector: #selector(frame(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  /// Puts the toolbar at rest at once, if it is not yet, and ends the change.
  func stop() {
    link?.invalidate()
    link = nil
    faceView.removeFromSuperview()
    bar?.outline = nil
  }

  @objc private func frame(_ link: CADisplayLink) {
    let time = link.targetTimestamp - start
    // Settled, or the toolbar went by a path that skipped ``stop()``.
    guard time < ends, bar?.window?.isVisible == true else { return stop() }
    step(time)
  }

  /// Puts the glass, the row and the face where they are `time` seconds in.
  private func step(_ time: Double) {
    guard let bar else { return }
    let share = MiniPanelShapeAxis.vertical.progress(
      across: Self.progress(motion.thickness, after: motion.thicknessDelay, at: time),
      along: Self.progress(motion.length, after: motion.lengthDelay, at: time))
    let shape = NSRect(
      x: icon.minX + (rest.minX - icon.minX) * share.x,
      y: icon.minY + (rest.minY - icon.minY) * share.y,
      width: icon.width + (rest.width - icon.width) * share.width,
      height: icon.height + (rest.height - icon.height) * share.height)
    let arrived = time - Self.arrival
    let opacity =
      arrived <= 0
      ? 0 : MiniPanelChoreography.contentOpacity.spring.value(target: 1.0, time: arrived)
    let faceScale = scale(shape, from: icon)
    let faceSize = NSSize(width: icon.width * faceScale, height: icon.height * faceScale)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    bar.outline = .init(
      rect: shape, rowScale: scale(shape, from: rest), rowOpacity: min(max(opacity, 0), 1))
    faceView.frame = NSRect(
      x: shape.midX - faceSize.width / 2, y: shape.midY - faceSize.height / 2,
      width: faceSize.width, height: faceSize.height)
    faceView.alphaValue = 1 - UnitCurve.easeIn.value(at: min(time / Self.leaving.exit, 1))
    CATransaction.commit()
  }

  /// How far content laid out at `rest` scales to stay inside `shape`, as the island's content
  /// follows its shape: never quite nothing, and at most a little past its rest.
  private func scale(_ shape: NSRect, from rest: NSRect) -> CGFloat {
    guard scales, rest.width > 0, rest.height > 0 else { return 1 }
    let fit = min(shape.width / rest.width, shape.height / rest.height)
    return min(max(fit, 0.01), MiniPanelChoreography.followLimit)
  }

  /// How far along a unit change `spring` is `time` seconds in, once `delay` has passed.
  private static func progress(_ spring: MiniPanelSpring, after delay: Double, at time: Double)
    -> Double
  {
    time <= delay ? 0 : spring.spring.value(target: 1.0, time: time - delay)
  }
}

/// The icon's face as it leaves: seen, never hit.
private final class PassiveImageView: NSImageView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
