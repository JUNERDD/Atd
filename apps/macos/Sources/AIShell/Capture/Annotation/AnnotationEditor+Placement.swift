import AICore
import AppKit

/// Where the editor's views sit across displays: a canvas on every overlay, each taking its
/// overlay's keyboard, and the bars on the display holding most of the selection.
extension AnnotationEditor {
  /// Either bar dragged: both move as one block, led by the toolbar.
  func moveBars(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began: dragOrigin = toolbar.frame.origin
    case .moved(let travel):
      movedOrigin = CGPoint(x: dragOrigin.x + travel.dx, y: dragOrigin.y + travel.dy)
    case .reset: movedOrigin = nil
    }
    placeToolbar()
  }

  /// Each overlay's keyboard goes to its canvas, so whichever overlay is key, keys reach the
  /// editor first, as on a single display.
  func focusCanvas() {
    guard !textEditor.isEditing else { return }
    for canvas in canvases { canvas.window?.makeFirstResponder(canvas) }
  }

  /// The tool or the selected annotation changed: the canvas under the pointer updates its
  /// cursor and element preview (the others would clear the preview it sets).
  func refreshPointer() {
    let mouse = NSEvent.mouseLocation
    canvases.first { NSMouseInRect(mouse, $0.window?.frame ?? .zero, false) }?.refreshPointer()
  }

  func redraw() {
    for canvas in canvases { canvas.needsDisplay = true }
  }

  /// The canvas on the display holding most of the selection (the first on a tie), whose host
  /// carries the bars.
  private var barCanvas: AnnotationCanvasView? {
    canvases.enumerated().max { (share(of: $0.1), -$0.0) < (share(of: $1.1), -$1.0) }?.element
  }

  private func share(of canvas: AnnotationCanvasView) -> CGFloat {
    guard let host = canvas.superview else { return 0 }
    let shared = host.bounds.intersection(selection)
    return shared.isNull ? 0 : shared.width * shared.height
  }

  /// Both bars as one block (``AnnotationToolbarLayout``), beside the selection's part on the
  /// display holding most of it, or where the user dragged them on that display, with room
  /// kept for the style bar's widest form so the toolbar stays put while the style bar comes
  /// and goes or narrows. When most of the selection moves to another display, the bars move
  /// there and follow the selection again.
  func placeToolbar() {
    guard let host = barCanvas?.superview else { return }
    if toolbar.superview !== host {
      if toolbar.superview != nil { movedOrigin = nil }
      host.addSubview(toolbar)
      host.addSubview(styleBar)
    }
    let display = host.bounds
    let part = selection.intersection(display)
    let frames =
      if let movedOrigin {
        AnnotationToolbarLayout.frames(
          toolbar: toolbar.fittingSize, styleBar: styleBar.fullSize, at: movedOrigin,
          within: display)
      } else {
        AnnotationToolbarLayout.frames(
          toolbar: toolbar.fittingSize, styleBar: styleBar.fullSize,
          beside: part.isNull ? selection : part, within: display)
      }
    toolbar.frame = frames.toolbar
    styleBar.frame = CGRect(origin: frames.styleBar.origin, size: styleBar.fittingSize)
  }
}
