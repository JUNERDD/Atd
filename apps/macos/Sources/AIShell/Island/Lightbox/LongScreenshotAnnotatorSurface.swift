import AppKit

/// The annotator's canvas as the lightbox's viewer holds it (``LongScreenshotAnnotator/canvas``):
/// a flipped view the size of the image in points, holding the editor's canvas
/// (``AnnotationCanvasView``), which reads it as its host and the viewer's document view as the
/// host's overlay. It decides what reaches the canvas:
///
/// - The pointer only while drawing (``isActive``), and only where the canvas is what the window
///   shows under it: the lightbox's chrome and the annotator's bars lie over the image in other
///   views, so a point under them is not the canvas's, for presses and for the cursor the canvas
///   sets on every move alike. Display only, it takes no pointer at all.
/// - Key equivalents only while drawing: AppKit offers them to every view in the window, so an
///   inactive canvas would otherwise take ⌘Z and ⌘Delete in the lightbox's view mode.
///
/// Wheel and magnify events are never handled here or in the canvas: they go up the responder
/// chain to the scroll view.
final class LongScreenshotAnnotatorSurface: NSView {
  /// Drawing: the pointer and the key equivalents reach the canvas.
  var isActive = false
  /// The view joined a window (the viewer placed it), where the canvas can take the keyboard.
  var onWindow: (() -> Void)?
  /// A hit test of the whole window is under way from here: it must not start another one.
  private var probing = false

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard isActive, let hit = super.hitTest(point) else { return nil }
    guard !probing, let window, let root = window.contentView, let superview else { return hit }
    probing = true
    defer { probing = false }
    let location = superview.convert(point, to: nil)
    let top = root.hitTest(root.superview?.convert(location, from: nil) ?? location)
    return top?.isDescendant(of: self) == true ? hit : nil
  }

  /// The pointer rests on the canvas as the window shows it, while drawing.
  var isUnderPointer: Bool {
    guard let window, window.isVisible, let superview else { return false }
    return hitTest(superview.convert(window.mouseLocationOutsideOfEventStream, from: nil)) != nil
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    isActive && super.performKeyEquivalent(with: event)
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { onWindow?() }
  }
}
