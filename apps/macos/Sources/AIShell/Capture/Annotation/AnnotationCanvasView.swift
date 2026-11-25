import AICore
import AppKit

/// The annotation surface over the committed selection, a flipped subview of a host overlay
/// view. Its frame is the selection and its bounds origin the selection's origin, so its points
/// are the host's, desktop points: annotations, the text editor and pointer locations keep their
/// place on the screen while the selection moves or resizes over them (decision D14). Every
/// display's overlay has one over the same selection (``AnnotationEditor``), so a selection
/// spanning displays is annotated on all of them; each shows the part on its display.
///
/// Focus and key contract with the host (the capture overlay view, this view's superview's
/// superview and so up its responder chain):
/// - From ``AnnotationEditor/show`` on, this view is the window's first responder (the text
///   view is while text is edited). The host must not take first responder back while the
///   editor is shown. While text is open on another display's canvas, every key reaching this
///   view goes to the text, whose window takes the keyboard back.
/// - The host routes the pointer (``AnnotationHostView``): the selection's handles and edge
///   band always go to the session, while annotations and active tools reach this canvas.
/// - Delete removes selected annotations and arrows nudge them (Shift ×10) even after direct
///   selection without an active drawing tool; `[` and `]` step stroke/size; `⌘Delete` clears
///   all annotations; `⌘C` stays with text selection / result card / screenshot copy while `⇧⌘C`
///   copies selected annotations; `⌘D` duplicates, `⌘V` pastes, `⌘]`/`⌘[` reorder z-order, `⌘P`
///   pins, and `⌘A` selects text paragraphs or all annotations.
/// - Esc steps back one level (E6); open text ends on Esc in the text view itself.
///
/// Text mode and the text commands' step badges come first (``pointerOwner``): while text mode
/// is on, or over a badge with no tool chosen, presses, hover and the cursor are the owner's.
final class AnnotationCanvasView: NSView {
  let store: AnnotationStore
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  private let renderer: AnnotationRenderer
  private let picker: AnnotationElementPicker

  /// The frozen pixels mosaic regions and the eyedropper sample: the displays a selection spans
  /// rather than only the clipped rect, so mosaics keep their grid when the selection moves.
  var backdrop: CaptureBackdrop? {
    didSet { needsDisplay = true }
  }

  /// A press reached this canvas (before it is handled).
  var onPress: (() -> Void)?
  /// Returns true if an active text selection handled ⌘C ahead of screenshot copy.
  var onCopySelectionText: (() -> Bool)?
  /// ⌘C outside open text.
  var onCopy: (() -> Void)?
  /// ⌘S outside field editors and IME marked text.
  var onSave: (() -> Void)?
  var onConfirm: (() -> Void)?
  /// Tab / Shift-Tab annotation cycling when no text edit is open.
  var onTab: ((Bool) -> Bool)?
  /// ⌘P pin action when available in screenshot mode.
  var onPin: (() -> Void)?
  /// `I` key toggles eyedropper sampling mode.
  var onToggleEyedropper: (() -> Void)?
  /// Fired on eyedropper hover/drag (`commit == false`) and click (`commit == true`).
  var onSampleColor: ((AnnotationRGBA, Bool) -> Void)?
  /// Returns the formatted HUD text when stepping size via `[` / `]` or scroll wheel.
  var onStepSizeHUD: (() -> String?)?
  var onChooseTool: ((AnnotationTool) -> Void)?
  /// Esc: steps back one level; false when there was nothing to step back.
  var onEscape: (() -> Bool)?
  /// `[` `-` (-1) or `]` `=` (1): steps the style bar's size; false when it shows none.
  var onStepStroke: ((Int) -> Bool)?
  /// ⌘Delete: ends open text and clears every annotation; false when there was nothing to do.
  var onClearAll: (() -> Bool)?
  /// `/`: the command row turns into its ask field; false without a row.
  var onAsk: (() -> Bool)?
  /// ⌘A outside open text: true when text mode picked every paragraph.
  var onSelectAll: (() -> Bool)?
  /// ⌘↩: true when the result card took it.
  var onPrimary: (() -> Bool)?
  /// A press of the annotation interaction ended (its drawing, move or resize committed).
  var onGestureEnd: (() -> Void)?
  /// Takes presses, hover and the cursor ahead of the annotation interaction where it wants
  /// them: text mode, and a step badge a text command drew.
  weak var pointerOwner: (any AnnotationCanvasPointer)?
  /// Annotations left out of the drawing (a translation showing its original), the review
  /// preview's included; the export still has those of the document.
  var hiddenAnnotations: Set<UUID> = [] {
    didSet { if hiddenAnnotations != oldValue { needsDisplay = true } }
  }
  /// A text command's answer under review, drawn dashed over the annotations and never part of
  /// the document (``CaptureTextPreview``).
  var reviewPreview: CaptureTextPreview? {
    didSet { if reviewPreview != oldValue { needsDisplay = true } }
  }
  /// Text mode's and the text commands' washes over the canvas.
  let textLayer = CaptureTextLayerView()
  /// Transient direct-manipulation chrome (marquee, guides, handles, eyedropper loupe, size HUD).
  let overlay = AnnotationCanvasOverlay()
  /// The press in progress went to ``pointerOwner``.
  private var ownerPress = false
  /// Dragging the east width-reflow grip of the currently open text editor.
  private var draggingOpenTextWidth = false

  init(
    store: AnnotationStore, interaction: AnnotationInteraction, textEditor: AnnotationTextEditor,
    renderer: AnnotationRenderer, picker: AnnotationElementPicker
  ) {
    self.store = store
    self.interaction = interaction
    self.textEditor = textEditor
    self.renderer = renderer
    self.picker = picker
    super.init(frame: .zero)
    clipsToBounds = true
    addSubview(textLayer)
    // `activeAlways`: the overlay panel is non-activating; `inVisibleRect` follows the frame.
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [
          .mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeAlways, .inVisibleRect,
        ],
        owner: self))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  var isActive: Bool { interaction.tool != nil }

  /// Shows `selection` (view points): the frame moves over the host, the content stays put.
  func place(over selection: CGRect) {
    frame = selection
    setBoundsOrigin(selection.origin)
    textLayer.frame = bounds
    textLayer.setBoundsOrigin(bounds.origin)
    needsDisplay = true
  }

  /// Displays a transient centered HUD pill (e.g. step size, smart shape snap, copied feedback).
  func showSizeHud(_ text: String) {
    overlay.showSizeHud(text, on: self)
  }

  /// The tool or the selected annotation changed: the cursor and element preview follow at once
  /// under a still pointer.
  func refreshPointer() {
    guard let window else { return }
    updatePointer(at: window.mouseLocationOutsideOfEventStream)
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext else { return }
    var shown = store.shown
    for id in hiddenAnnotations { shown.remove(id) }
    renderer.draw(shown, hiding: store.editingID, in: context, backdrop: backdrop)
    if let reviewPreview {
      let edge = NSColor.controlAccentColor.withAlphaComponent(0.95).cgColor
      renderer.draw(reviewPreview, hiding: hiddenAnnotations, edge: edge, in: context)
    }
    if let frame = textEditor.frame, let style = textEditor.style, textEditor.isHosted(in: self) {
      drawOpenTextChrome(frame: frame, style: style, in: context)
    }
    overlay.draw(on: self, in: context)
    if let element = picker.preview(within: bounds) {
      Self.outline(element, in: context, width: 1.5)
    }
  }

  // MARK: Pointer

  private func point(of event: NSEvent) -> CGPoint {
    let point = convert(event.locationInWindow, from: nil)
    return CGPoint(
      x: min(max(point.x, bounds.minX), bounds.maxX),
      y: min(max(point.y, bounds.minY), bounds.maxY))
  }

  override func mouseDown(with event: NSEvent) {
    onPress?()
    let point = point(of: event)
    if textEditor.isEditing, openTextWidthGripHit(at: point) {
      interaction.disarmConfirmDoubleClick()
      draggingOpenTextWidth = true
      SelectionHandle.right.cursor.set()
      return
    }
    // A click away from open text only ends the edit.
    if textEditor.isEditing {
      interaction.disarmConfirmDoubleClick()
      textEditor.end()
      updatePointer(at: event.locationInWindow)
      return
    }
    if window?.firstResponder !== self { window?.makeFirstResponder(self) }
    if interaction.eyedropperActive {
      interaction.disarmConfirmDoubleClick()
      sampleEyedropper(at: point, commit: true)
      interaction.directManipulationCursor(at: point)?.set()
      return
    }
    if let owner = pointerOwner, owner.takesPress(at: point) {
      interaction.disarmConfirmDoubleClick()
      ownerPress = true
      owner.pressDown(at: point, flags: event.modifierFlags, clicks: event.clickCount)
      owner.cursor(at: point)?.set()
      return
    }
    interaction.mouseDown(
      at: point,
      clickCount: event.clickCount,
      shift: event.modifierFlags.contains(.shift),
      option: event.modifierFlags.contains(.option),
      timestamp: event.timestamp)
    interaction.directManipulationCursor(at: point)?.set()
  }

  override func mouseDragged(with event: NSEvent) {
    let point = point(of: event)
    overlay.pointerLocation = point
    if draggingOpenTextWidth, let info = openTextOutlineRect() {
      let width = max(24, point.x - info.plateRightPad - info.frame.minX)
      textEditor.resizeBoxWidth(to: width)
      SelectionHandle.right.cursor.set()
      return
    }
    if interaction.eyedropperActive {
      sampleEyedropper(at: point, commit: false)
      interaction.directManipulationCursor(at: point)?.set()
      return
    }
    if ownerPress, let owner = pointerOwner {
      owner.pressDragged(to: point)
      owner.cursor(at: point)?.set()
      return
    }
    interaction.mouseDragged(
      to: point,
      constrained: event.modifierFlags.contains(.shift),
      centered: event.modifierFlags.contains(.option))
    // No cursor updates arrive while the button is down; the gesture's cursor is kept here.
    interaction.directManipulationCursor(at: point)?.set()
    picker.hover(at: interaction.previewsElement(at: point) ? point : nil)
  }

  override func mouseUp(with event: NSEvent) {
    if draggingOpenTextWidth {
      draggingOpenTextWidth = false
      updatePointer(at: event.locationInWindow)
      return
    }
    if interaction.eyedropperActive {
      updatePointer(at: event.locationInWindow)
      return
    }
    if ownerPress {
      ownerPress = false
      pointerOwner?.pressUp(at: point(of: event))
    } else {
      interaction.mouseUp(at: point(of: event), timestamp: event.timestamp)
      onGestureEnd?()
    }
    updatePointer(at: event.locationInWindow)
  }

  override func mouseMoved(with event: NSEvent) {
    pointerOwner?.pointerMoved(to: convert(event.locationInWindow, from: nil))
    updatePointer(at: event.locationInWindow)
  }

  override func cursorUpdate(with event: NSEvent) { updatePointer(at: event.locationInWindow) }

  override func mouseExited(with event: NSEvent) {
    picker.hover(at: nil)
    pointerOwner?.pointerMoved(to: nil)
    overlay.pointerLocation = nil
    if interaction.eyedropperActive {
      overlay.eyedropperSample = nil
      interaction.hoveredRGBA = nil
      needsDisplay = true
    }
  }

  /// Sets the tool's cursor and element preview for the pointer at `location` (window
  /// coordinates) when the host routes the pointer there to this view; elsewhere the session or
  /// a bar owns the cursor and no element is previewed.
  func updatePointer(at location: CGPoint) {
    guard CaptureCursorOwnership.ownsPointer(in: window, at: NSEvent.mouseLocation),
      let host = superview, let parentOverlay = host.superview,
      host.hitTest(parentOverlay.convert(location, from: nil))?.isDescendant(of: self) == true
    else {
      picker.hover(at: nil)
      if overlay.pointerLocation != nil {
        overlay.pointerLocation = nil
        if interaction.eyedropperActive { needsDisplay = true }
      }
      return
    }
    let point = convert(location, from: nil)
    overlay.pointerLocation = point
    if interaction.eyedropperActive {
      sampleEyedropper(at: point, commit: false)
    }
    if textEditor.isEditing, openTextWidthGripHit(at: point) {
      SelectionHandle.right.cursor.set()
    } else if let editing = textEditor.frame, editing.contains(point) {
      PointerRole.text.cursor.set()
    } else if let cursor = pointerOwner?.cursor(at: point) {
      cursor.set()
    } else {
      interaction.directManipulationCursor(at: point)?.set()
    }
    let previews =
      !textEditor.isEditing && !interaction.eyedropperActive
      && interaction.previewsElement(at: point)
    picker.hover(at: previews ? point : nil)
  }
}

/// What takes a canvas's pointer ahead of the annotation interaction (the capture editor): text
/// mode's picks, marquee and character selection, and a click on a step badge a text command
/// drew. Points are the canvas's, desktop points.
protocol AnnotationCanvasPointer: AnyObject {
  /// Whether a press at `point` is the owner's rather than the interaction's.
  func takesPress(at point: CGPoint) -> Bool
  func pressDown(at point: CGPoint, flags: NSEvent.ModifierFlags, clicks: Int)
  func pressDragged(to point: CGPoint)
  func pressUp(at point: CGPoint)
  /// The pointer moved over a canvas, wherever the host routes presses (nil: it left).
  func pointerMoved(to point: CGPoint?)
  /// The owner's cursor at `point`; nil leaves it to the interaction.
  func cursor(at point: CGPoint) -> NSCursor?
  /// ⌥ went down or up.
  func optionChanged(_ down: Bool)
}
