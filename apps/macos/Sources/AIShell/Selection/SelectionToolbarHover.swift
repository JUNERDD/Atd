import AppKit
import QuartzCore

/// Hover for the selection toolbar's buttons. Atd stays inactive while the toolbar shows (the
/// app with the selection keeps focus), and the window server delivers an inactive app's
/// tracking events late or drops them when the pointer moves fast, so the buttons' own tracking
/// areas lag behind the pointer. Instead, while the toolbar shows, this reads the pointer on
/// every display frame, washes the button under it and shows the pointing hand there, or the
/// open hand over the drag handle (``BackgroundCursor`` lets an inactive app set the cursor).
///
/// The frame callbacks pause once the pointer has rested away from the toolbar for
/// ``idleFrames``; the next move over another app (seen by the controller's monitor) resumes
/// them before the pointer can reach the toolbar, so hover never waits on a frame.
@MainActor
final class SelectionToolbarHover: NSObject {
  private var buttons: [AnnotationToolbarButton] = []
  private var grip: NSView?
  /// The view under the pointer: a button or the grip.
  private var hovered: NSView?
  private var link: CADisplayLink?
  /// Where the pointer was at the last frame, and for how many frames it stayed there.
  private var lastPointer: CGPoint?
  private var stillFrames = 0

  static let idleFrames = 30
  /// How close to the toolbar the pointer keeps the frame callbacks running even at rest.
  static let nearMargin: CGFloat = 24

  /// Follows the pointer over `buttons` and `grip`, shown in `view`'s window, until ``stop()``.
  func start(_ buttons: [AnnotationToolbarButton], grip: NSView, in view: NSView) {
    stop()
    BackgroundCursor.enable()
    self.buttons = buttons
    self.grip = grip
    for button in buttons { button.followsPointer = false }
    let link = view.displayLink(target: self, selector: #selector(frame(_:)))
    link.add(to: .main, forMode: .common)
    self.link = link
    update()
  }

  /// Ends following; the cursor goes back to the arrow if the pointer was on a button, since
  /// the toolbar hides under it and no later move would restore it.
  func stop() {
    link?.invalidate()
    link = nil
    if hovered != nil { NSCursor.arrow.set() }
    (hovered as? AnnotationToolbarButton)?.isHovered = false
    hovered = nil
    buttons = []
    grip = nil
    lastPointer = nil
    stillFrames = 0
  }

  /// The pointer moved outside the toolbar: resume the frame callbacks if they paused.
  func pointerMoved() {
    guard let link, link.isPaused else { return }
    stillFrames = 0
    link.isPaused = false
    update()
  }

  @objc private func frame(_ link: CADisplayLink) {
    // Hidden by any path that skipped ``stop()`` (the app quitting orders every window out):
    // never keep firing for a window that is gone.
    guard let window = buttons.first?.window, window.isVisible else { return stop() }
    update()
    let pointer = NSEvent.mouseLocation
    stillFrames = pointer == lastPointer ? stillFrames + 1 : 0
    lastPointer = pointer
    let near = window.frame.insetBy(dx: -Self.nearMargin, dy: -Self.nearMargin).contains(pointer)
    if stillFrames >= Self.idleFrames, !near { link.isPaused = true }
  }

  private func update() {
    let pointer = NSEvent.mouseLocation
    let candidates: [NSView] = buttons.filter(\.isEnabled) + (grip.map { [$0] } ?? [])
    let target = candidates.first { view in
      guard let window = view.window else { return false }
      return window.convertToScreen(view.convert(view.bounds, to: nil)).contains(pointer)
    }
    guard target !== hovered else { return }
    (hovered as? AnnotationToolbarButton)?.isHovered = false
    (target as? AnnotationToolbarButton)?.isHovered = true
    hovered = target
    switch target {
    case nil: NSCursor.arrow.set()
    case let view? where view === grip: NSCursor.openHand.set()
    default: NSCursor.pointingHand.set()
    }
  }
}
