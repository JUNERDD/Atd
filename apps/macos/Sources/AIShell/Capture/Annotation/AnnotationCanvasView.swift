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
///   band always go to the session, the rest of the interior comes here only once a tool is
///   chosen. Before that, of the keys only tool letters, ⌘Z and ⇧⌘Z are taken here.
/// - Once a tool is chosen this view also takes Return or Enter (confirm), Delete (removes the
///   selected annotation) and arrows while an annotation is selected (nudge it, Shift ×10).
/// - `[` and `]` step the stroke the style bar shows down or up, whenever it shows one (while
///   text is typed, the text view keeps them as characters). ⌘Delete clears every annotation,
///   typing included, as one undo step. ⌘C goes to the editor (text mode's selection, the result
///   card's answer, else the screenshot); ⌘A picks every paragraph in text mode; ⌘↩ is the result
///   card's primary action.
/// - Esc steps back one level (E6) and is taken only when it did: a gesture in progress is
///   dropped, else the selected annotation is deselected, else the tool is dropped (the
///   interior goes back to the session). Open text ends on Esc in the text view itself.
/// - Everything else goes up the responder chain to the host: Esc with nothing to step back
///   (cancel the session), Tab, arrows with nothing selected and Option-arrows (they nudge or
///   resize the selection), Return while idle, and right-clicks (the session decides with
///   ``AnnotationEditing/hasAnnotations``).
///
/// Text mode and the text commands' step badges come first (``pointerOwner``): while text mode
/// is on, or over a badge with no tool chosen, presses, hover and the cursor are the owner's.
///
/// Cursors: this view sets its own (``AnnotationInteraction/cursor(at:)``) from a tracking area,
/// only where the host routes the pointer here, so it never fights the session's cursors over
/// the handles, the edge band or the bars. The same routing decides where the element preview
/// of a tool that boxes elements shows (E10).
final class AnnotationCanvasView: NSView {
  let store: AnnotationStore
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  private let renderer: AnnotationRenderer
  private let picker: AnnotationElementPicker

  /// The frozen pixels mosaic regions pixelate: the whole display (or the displays a selection
  /// spans) rather than the selection, so a mosaic keeps its blocks when the selection moves.
  var backdrop: CaptureBackdrop? {
    didSet { needsDisplay = true }
  }

  /// A press reached this canvas (before it is handled).
  var onPress: (() -> Void)?
  /// ⌘C outside open text.
  var onCopy: (() -> Void)?
  var onConfirm: (() -> Void)?
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
  /// the document (``CaptureTextReviewPreview``).
  var reviewPreview: CaptureTextPreview? {
    didSet { if reviewPreview != oldValue { needsDisplay = true } }
  }
  /// Text mode's and the text commands' washes over the canvas.
  let textLayer = CaptureTextLayerView()
  /// The press in progress went to ``pointerOwner``.
  private var ownerPress = false

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
      // Open text: the plate goes behind the transparent text view, the outline around both.
      var area = frame
      if style.hasTextPlate {
        AnnotationRenderer.drawTextPlate(around: frame, style: style, in: context)
        area = AnnotationPath.textPlate(around: frame, fontSize: style.textFontSize)
      }
      Self.outline(area.insetBy(dx: -4, dy: -3), in: context)
    } else if let selected = store.selected {
      drawGrips(of: selected, in: context)
    }
    if let element = picker.preview(within: bounds) {
      Self.outline(element, in: context, width: 1.5)
    }
  }

  /// Grips for shapes that resize; a dashed frame for those that only move, and around a
  /// spotlight, which has no outline of its own.
  private func drawGrips(of annotation: Annotation, in context: CGContext) {
    let handles = annotation.handles
    if case .spotlight(let rect) = annotation.shape { Self.outline(rect, in: context) }
    guard !handles.isEmpty else {
      Self.outline(annotation.bounds.insetBy(dx: -3, dy: -3), in: context)
      return
    }
    context.setLineWidth(1.5)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.setFillColor(NSColor.white.cgColor)
    for (_, point) in handles {
      let grip = CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)
      context.fillEllipse(in: grip)
      context.strokeEllipse(in: grip)
    }
  }

  private static func outline(_ rect: CGRect, in context: CGContext, width: CGFloat = 1) {
    context.saveGState()
    context.setLineWidth(width)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.setLineDash(phase: 0, lengths: [4, 3])
    context.stroke(rect.insetBy(dx: width / 2, dy: width / 2))
    context.restoreGState()
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
    // A click away from open text only ends the edit.
    if textEditor.isEditing {
      textEditor.end()
      updatePointer(at: event.locationInWindow)
      return
    }
    window?.makeFirstResponder(self)
    let point = point(of: event)
    if let owner = pointerOwner, owner.takesPress(at: point) {
      ownerPress = true
      owner.pressDown(at: point, flags: event.modifierFlags, clicks: event.clickCount)
      owner.cursor(at: point)?.set()
      return
    }
    interaction.mouseDown(at: point, clickCount: event.clickCount)
    interaction.cursor(at: point)?.set()
  }

  override func mouseDragged(with event: NSEvent) {
    let point = point(of: event)
    if ownerPress, let owner = pointerOwner {
      owner.pressDragged(to: point)
      owner.cursor(at: point)?.set()
      return
    }
    interaction.mouseDragged(to: point, constrained: event.modifierFlags.contains(.shift))
    // No cursor updates arrive while the button is down; the gesture's cursor is kept here.
    interaction.cursor(at: point)?.set()
    picker.hover(at: interaction.previewsElement(at: point) ? point : nil)
  }

  override func mouseUp(with event: NSEvent) {
    if ownerPress {
      ownerPress = false
      pointerOwner?.pressUp(at: point(of: event))
    } else {
      interaction.mouseUp()
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
  }

  /// Sets the tool's cursor and element preview for the pointer at `location` (window
  /// coordinates) when the host routes the pointer there to this view; elsewhere the session or
  /// a bar owns the cursor and no element is previewed.
  private func updatePointer(at location: CGPoint) {
    guard CaptureCursorOwnership.ownsPointer(in: window, at: NSEvent.mouseLocation),
      let host = superview, let overlay = host.superview,
      host.hitTest(overlay.convert(location, from: nil))?.isDescendant(of: self) == true
    else {
      picker.hover(at: nil)
      return
    }
    let point = convert(location, from: nil)
    if let editing = textEditor.frame, editing.contains(point) {
      NSCursor.iBeam.set()
    } else if let cursor = pointerOwner?.cursor(at: point) {
      cursor.set()
    } else {
      interaction.cursor(at: point)?.set()
    }
    let previews = !textEditor.isEditing && interaction.previewsElement(at: point)
    picker.hover(at: previews ? point : nil)
  }

  // MARK: Keys

  override func keyDown(with event: NSEvent) {
    if textEditor.isEditing, !textEditor.isHosted(in: self) {
      textEditor.type(event)
      return
    }
    if handleKey(event) { return }
    super.keyDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    keyEquivalent(event) ?? super.performKeyEquivalent(with: event)
  }

  /// ⌥ shows the originals of translated text while it is held; the host still hears it, for a
  /// drag reshaped with Shift.
  override func flagsChanged(with event: NSEvent) {
    pointerOwner?.optionChanged(event.modifierFlags.contains(.option))
    super.flagsChanged(with: event)
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
