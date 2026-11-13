import AICore
import AppKit

// The capture overlay's cursors (decision D15) in one place. The session sets the selection's
// (``CaptureSession``'s `overlay(_:cursorAt:)`): frame-resize over its handles and edge band,
// an open hand inside it before a tool is chosen (closed while moving), the arrow outside it.
// Over the bars, the pointing hand on an enabled button (``PointerRole``), the arrow on another
// control and an open hand on the surface that drags them (closed while dragging). The
// annotation canvas sets its own over the interior a tool claimed:
//
// | Under the pointer (or the gesture running)       | Cursor                        |
// | ------------------------------------------------ | ----------------------------- |
// | grip of the selected box shape, or resizing it   | frame-resize for that grip    |
// | end of the selected arrow or line, or dragging it | crosshair                    |
// | an annotation a press would select or drag       | open hand                     |
// | dragging an annotation                           | closed hand                   |
// | text the text tool would open                    | I-beam                        |
// | empty canvas: select / text / drawing tools      | arrow / I-beam / crosshair    |
//
// With no tool chosen the editor sets these over the interior instead (text mode claims it; a
// badge is claimed by itself, ``AnnotationEditing/claimsPress(at:)``):
//
// | Under the pointer (or the gesture running)       | Cursor                        |
// | ------------------------------------------------ | ----------------------------- |
// | a step badge a text command drew                 | pointing hand                 |
// | text mode: a paragraph, or selecting characters  | I-beam                        |
// | text mode: elsewhere, or drawing a marquee       | crosshair                     |
//
// Over a text command's result card its controls set their own (their ``PointerRole``s, through
// the overlay window's hover clock); the arrow shows on the rest of it.

/// Full-screen tracking areas still receive events beneath separate menu windows. Only the
/// front window under the pointer may set a hover cursor; an in-progress drag keeps its owner.
@MainActor
enum CaptureCursorOwnership {
  static func ownsPointer(in window: NSWindow?, at point: CGPoint) -> Bool {
    guard let window, window.isVisible else { return false }
    return NSWindow.windowNumber(at: point, belowWindowWithWindowNumber: 0) == window.windowNumber
  }
}

extension SelectionHandle {
  /// The system's frame-resize cursor for this handle.
  var cursor: NSCursor {
    let position: NSCursor.FrameResizePosition =
      switch self {
      case .topLeft: .topLeft
      case .top: .top
      case .topRight: .topRight
      case .right: .right
      case .bottomRight: .bottomRight
      case .bottom: .bottom
      case .bottomLeft: .bottomLeft
      case .left: .left
      }
    return .frameResize(position: position, directions: .all)
  }
}

extension AnnotationHandle {
  /// A box grip resizes like the selection's handle at the same place; a line end moves a
  /// point freely, for which the system has no resize cursor.
  var cursor: NSCursor { boxHandle?.cursor ?? .crosshair }
}

extension AnnotationInteraction {
  /// The cursor for the pointer at `point` (canvas, that is view, points): the running
  /// gesture's, else what a press there would do; nil before a tool is chosen.
  func cursor(at point: CGPoint) -> NSCursor? {
    guard let tool else { return nil }
    switch gesture {
    case .drawing: return Self.canvasCursor(tool)
    case .moving: return .closedHand
    case .resizing(_, let handle): return handle.cursor
    case .idle: break
    }
    switch target(at: point) {
    case .grip(let handle): return handle.cursor
    case .annotation: return .openHand
    case .text: return .iBeam
    case .canvas, nil: return Self.canvasCursor(tool)
    }
  }

  private static func canvasCursor(_ tool: AnnotationTool) -> NSCursor {
    switch tool {
    case .select: .arrow
    case .text: .iBeam
    case .rectangle, .ellipse, .arrow, .line, .pen, .highlighter, .mosaic, .spotlight, .step:
      .crosshair
    }
  }
}

extension CaptureTextMode {
  /// Text mode's cursor at `point`: what a press there does (picks or selects text over a
  /// paragraph, starts a marquee elsewhere), or the gesture in progress's.
  func cursor(at point: CGPoint) -> NSCursor {
    let role: PointerRole =
      switch gesture {
      case .marquee: .marquee
      case .characters: .text
      case .idle, .pressed, .cancelled: paragraph(at: point) != nil ? .text : .marquee
      }
    return role.cursor
  }
}

extension AnnotationEditor {
  /// The cursor of what a text command drew at `point` while no tool is chosen: a step badge
  /// acts (its result card opens), and in text mode so does a highlighter mark of a run with
  /// versions (``CaptureTextRuns/mark(at:in:)``), else text mode's; nil leaves the cursor to the
  /// interaction.
  func textCursor(at point: CGPoint) -> NSCursor? {
    guard interaction.tool == nil else { return nil }
    if stepBadge(at: point) != nil { return PointerRole.action.cursor }
    guard text.mode.isOn else { return nil }
    if text.runs.mark(at: point, in: store.document) != nil { return PointerRole.action.cursor }
    return text.mode.cursor(at: point)
  }
}
