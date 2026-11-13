import AppKit

/// The annotation editor's canvas and bars live here. Its bounds equal its frame, the overlay's
/// bounds, so its points are desktop points like the overlay's. Its own area never takes the mouse, and
/// neither do the points `passThrough` answers true for (the session's: the selection's handles
/// and edge band, and its interior until a tool claims it), so those presses reach the overlay
/// view whatever the editor puts there — except the bars' controls, which sit inside the
/// selection when it fills the display and must still be clickable.
final class AnnotationHostView: NSView {
  /// Takes points in this view's (equally, the overlay's) coordinates.
  var passThrough: ((CGPoint) -> Bool)?
  /// Offered every scroll-wheel event over the overlay first, wherever it lands (canvas, bars or
  /// the overlay itself); true when the editor took it.
  var scroll: ((NSEvent) -> Bool)?

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    guard let hit, hit !== self else { return nil }
    if passThrough?(point) == true, !Self.isInBar(hit) { return nil }
    return hit
  }

  /// The cursor at `point` (the overlay's coordinates) when it is on one of the bars: the I-beam
  /// over a text field, the button's ``PointerRole`` over a button (the pointing hand while it is
  /// enabled), the arrow over another control or a bar that does not move, an open hand over the
  /// surface of one that does; nil off them.
  func barCursor(at point: CGPoint) -> NSCursor? {
    guard let hit = super.hitTest(point), Self.isInBar(hit) else { return nil }
    let chain = Array(sequence(first: hit, next: \.superview))
    if chain.contains(where: { ($0 as? NSTextField)?.isEditable == true || $0 is NSTextView }) {
      return .iBeam
    }
    if let button = chain.lazy.compactMap({ $0 as? NSButton }).first {
      return PointerRole(button: button).cursor
    }
    let bar = chain.lazy.compactMap { $0 as? AnnotationGlassBar }.first
    let passive = chain.contains { $0 is NSControl } || bar?.onDrag == nil
    return (passive ? PointerRole.passive : .grab).cursor
  }

  /// The result card under `point` (the overlay's coordinates), whose controls set their own
  /// cursors.
  func card(at point: CGPoint) -> CaptureResultCardHost? {
    guard let hit = super.hitTest(point) else { return nil }
    return sequence(first: hit, next: \.superview).lazy.compactMap { $0 as? CaptureResultCardHost }
      .first
  }

  /// A bar or the result card: they take their presses wherever they lie, over the selection too.
  private static func isInBar(_ view: NSView) -> Bool {
    sequence(first: view, next: \.superview).contains {
      $0 is AnnotationGlassBar || $0 is CaptureResultCardHost
    }
  }
}

/// The frozen display image; drawn once, never hit.
final class FrozenImageView: NSImageView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
