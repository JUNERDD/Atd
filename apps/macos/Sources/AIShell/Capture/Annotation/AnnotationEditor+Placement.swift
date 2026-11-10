import AICore
import AppKit

/// Where the editor's views sit across displays: a canvas on every overlay, each taking its
/// overlay's keyboard, and the bars on the display holding most of the selection.
extension AnnotationEditor {
  /// Either bar dragged: both move as one block, led by the toolbar; open menus close.
  func moveBars(_ drag: AnnotationGlassBar.Drag) {
    slot.closeMenus()
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

  /// The toolbar and its second row as one block (``AnnotationToolbarLayout``), beside the
  /// selection's part on the display holding most of it and clear of the bottom bar and the size
  /// label (``keepClear``), or where the user dragged them on that display. The second row's
  /// room is the widest of the style bar's fullest form and the command slot (C5), so the toolbar
  /// stays put while a tool is chosen or dropped and the style bar comes, goes or narrows. When
  /// most of the selection moves to another display, the bars move there and follow the
  /// selection again. While the selection is dragged they hold the place they took beside it
  /// (``AnnotationToolbarLayout/Anchor``) for as long as it fits.
  func placeToolbar() {
    guard let host = barCanvas?.superview else { return }
    if toolbar.superview !== host {
      if toolbar.superview != nil { movedOrigin = nil }
      for view in [toolbar, styleBar] + slot.views { host.addSubview(view) }
    }
    let display = host.bounds
    let part = selection.intersection(display)
    let style = styleBar.fullSize
    let room = NSSize(
      width: max(style.width, slot.size.width), height: max(style.height, slot.size.height))
    let frames: (toolbar: CGRect, styleBar: CGRect)
    if let movedOrigin {
      frames = AnnotationToolbarLayout.frames(
        toolbar: toolbar.fittingSize, styleBar: room, at: movedOrigin, within: display)
    } else {
      let placed = AnnotationToolbarLayout.frames(
        toolbar: toolbar.fittingSize, styleBar: room, beside: part.isNull ? selection : part,
        within: display, keepClear: keepClear, holding: isDragged ? anchor : nil)
      anchor = placed.anchor
      frames = (placed.toolbar, placed.styleBar)
    }
    toolbar.frame = frames.toolbar
    styleBar.frame = CGRect(origin: frames.styleBar.origin, size: styleBar.fittingSize)
    slot.place(at: frames.styleBar.origin)
  }
}
