import AICore
import AppKit

/// The annotation step of a capture session (``AnnotationEditing``): a canvas over the
/// committed selection on every display's overlay, a glass toolbar beside it and, while there
/// is something to style, the style bar next to the toolbar. Annotations are in desktop points,
/// so they stay on the screen while the selection moves or resizes; the canvases and the bars
/// follow the selection, and the export takes what lies inside it.
///
/// A selection may span displays. Each overlay then holds its own canvas over the same
/// selection, all drawing the one document and feeding the one interaction, so a stroke drawn
/// on one display continues on the next (a drag keeps reaching the canvas it began on). The
/// bars sit on the display holding most of the selection and move with it; open text lives in
/// the canvas it was started on. Focus and key routing between a canvas and its host are
/// described on ``AnnotationCanvasView``.
///
/// The model, hit-testing and geometry are AICore's (`Annotation*.swift`); this type wires the
/// store, the pointer state machine, the text editor, the renderer, the element picker and the
/// bars together, and remembers the styles across sessions (``AnnotationStyleMemory``, E8).
/// Written for this app on platform APIs only (D5); no third-party annotation code is used.
final class AnnotationEditor: AnnotationEditing {
  var onConfirm: (() -> Void)?
  var onCancel: (() -> Void)?
  var onCopy: (() -> Void)?
  var onInteriorClaimChange: ((Bool) -> Void)?

  private let store = AnnotationStore()
  private let renderer = AnnotationRenderer()
  private let picker = AnnotationElementPicker()
  private let defaults: UserDefaults
  private let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  /// One per host, in the hosts' order; empty while hidden.
  private(set) var canvases: [AnnotationCanvasView] = []
  /// The canvas pressed last, which new text opens in.
  private weak var pressedCanvas: AnnotationCanvasView?
  let toolbar = AnnotationToolbar()
  let styleBar = AnnotationStyleBar()

  /// What mosaics sample for a selection (the session's), and its answer for the current one.
  private var backdrops: ((CGRect) -> CaptureBackdrop?)?
  private var backdrop: CaptureBackdrop?
  private(set) var selection = CGRect.zero
  /// Where the user dragged the toolbar to, in desktop points: it stays there while the bars
  /// stay on the same display, whatever the selection does. Nil while the bars follow the
  /// selection.
  var movedOrigin: CGPoint?
  /// The run of wheel ticks in progress (``scroll(_:)``) and when its last tick came.
  private var wheelBurst = UUID()
  private var lastWheel: TimeInterval = 0
  /// The toolbar's origin when the drag in progress began.
  var dragOrigin = CGPoint.zero

  /// `defaults` keeps the remembered styles.
  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    interaction = AnnotationInteraction(store: store)
    textEditor = AnnotationTextEditor(store: store)
    store.onChange = { [weak self] in self?.refresh() }
    picker.onChange = { [weak self] in self?.redraw() }
    interaction.elementBox = { [weak self] point in
      guard let self else { return nil }
      return picker.box(at: point, within: selection)
    }
    interaction.onStylesChange = { [weak self] styles in
      guard let self else { return }
      AnnotationStyleMemory.save(styles, to: self.defaults)
    }
    interaction.onEditText = { [weak self] point, existing in self?.editText(at: point, existing) }
    interaction.onConfirm = { [weak self] in self?.confirm() }
    textEditor.onEnd = { [weak self] in self?.focusCanvas() }
    toolbar.onTool = { [weak self] in self?.choose($0) }
    styleBar.onChange = { [weak self] in self?.restyle($0, burst: $1) }
    toolbar.onUndo = { [weak self] in self?.store.undo() }
    toolbar.onRedo = { [weak self] in self?.store.redo() }
    toolbar.onCancel = { [weak self] in self?.onCancel?() }
    toolbar.onConfirm = { [weak self] in self?.confirm() }
    toolbar.onCopy = { [weak self] in self?.copy() }
    toolbar.onDrag = { [weak self] in self?.moveBars($0) }
    styleBar.onDrag = { [weak self] in self?.moveBars($0) }
  }

  func show(
    in hosts: [AnnotationHostView], selection: CGRect,
    backdrop: @escaping (CGRect) -> CaptureBackdrop?
  ) {
    hide()
    backdrops = backdrop
    interaction.styles = AnnotationStyleMemory.load(from: defaults)
    toolbar.applyStrings()
    styleBar.applyStrings()
    canvases = hosts.map { host in
      let canvas = makeCanvas()
      host.addSubview(canvas)
      return canvas
    }
    selectionDidChange(selection)
    refresh()
    focusCanvas()
  }

  /// A canvas wired to the shared document, interaction and actions.
  private func makeCanvas() -> AnnotationCanvasView {
    let canvas = AnnotationCanvasView(
      store: store, interaction: interaction, textEditor: textEditor, renderer: renderer,
      picker: picker)
    canvas.onPress = { [weak self, weak canvas] in self?.pressedCanvas = canvas }
    canvas.onConfirm = { [weak self] in self?.confirm() }
    canvas.onCopy = { [weak self] in self?.copy() }
    canvas.onChooseTool = { [weak self] in self?.choose($0) }
    canvas.onEscape = { [weak self] in self?.stepBack() ?? false }
    canvas.onStepStroke = { [weak self] in self?.stepStroke($0) ?? false }
    canvas.onClearAll = { [weak self] in self?.clearAll() ?? false }
    return canvas
  }

  var hasAnnotations: Bool { !store.document.isEmpty || textEditor.isEditing }

  /// Selection-local: the origin is the selection's top-left, whatever it is on the screen now.
  var document: AnnotationDocument {
    store.document.translated(by: CGVector(dx: -selection.minX, dy: -selection.minY))
  }

  func restore(_ document: AnnotationDocument) {
    textEditor.cancel()
    interaction.cancelGesture()
    store.load(document.translated(by: CGVector(dx: selection.minX, dy: selection.minY)))
    refreshPointer()
  }

  var elementTargets: ((CGPoint) async -> [CGRect])? {
    didSet { picker.targets = elementTargets }
  }

  func selectionDidChange(_ selection: CGRect) {
    self.selection = selection
    // A selection moving onto another display, or across displays, samples other pixels.
    let backdrop = backdrops?(selection)
    let changed = backdrop?.image !== self.backdrop?.image
    self.backdrop = backdrop
    for canvas in canvases {
      if changed { canvas.backdrop = backdrop }
      canvas.place(over: selection)
    }
    textEditor.selectionDidChange()
    placeToolbar()
  }

  func hide() {
    interaction.cancelGesture()
    textEditor.cancel()
    for canvas in canvases {
      canvas.removeFromSuperview()
      canvas.backdrop = nil
    }
    canvases = []
    toolbar.removeFromSuperview()
    styleBar.removeFromSuperview()
    interaction.tool = nil
    picker.reset()
    store.reset()
    backdrops = nil
    backdrop = nil
    movedOrigin = nil
  }

  /// Annotations are in desktop points: `transform` moves them into the export's pixels and
  /// they are clipped to the selection. Mosaics sample the canvases' backdrop rather than the
  /// export, so one reaching past the selection pixelates exactly as on the canvas. Nothing is
  /// drawn once hidden.
  func render(into context: CGContext, transform: CGAffineTransform) {
    guard !canvases.isEmpty else { return }
    context.saveGState()
    context.concatenate(transform)
    context.clip(to: selection)
    renderer.draw(store.document, in: context, backdrop: backdrop)
    context.restoreGState()
  }

  // MARK: Actions

  /// Picks a tool, or drops it (nil). Having a tool claims the selection's interior from the
  /// session (D14), which still owns the handles and the edge band; dropping it hands the
  /// interior back.
  private func choose(_ tool: AnnotationTool?) {
    textEditor.end()
    interaction.cancelGesture()
    let claimed = interaction.tool != nil
    interaction.tool = tool
    if claimed != (tool != nil) { onInteriorClaimChange?(tool != nil) }
    refreshPointer()
    refresh()
    focusCanvas()
  }

  /// Esc steps back one level (E6): ends open text, else drops a gesture in progress, else
  /// deselects, else drops the tool. False when none applied, so the key goes on to the
  /// session, which cancels.
  private func stepBack() -> Bool {
    if textEditor.isEditing {
      textEditor.end()
    } else if interaction.isGesturing {
      interaction.cancelGesture()
    } else if store.selectedID != nil {
      store.selectedID = nil
    } else if interaction.tool != nil {
      choose(nil)
    } else {
      return false
    }
    refreshPointer()
    return true
  }

  /// A style bar change: it restyles the open text, else the selected annotation, and becomes
  /// the style of the next new annotation of the same slot. Only the part picked changes.
  /// Changes sharing a `burst` (a size slider drag, a run of wheel ticks) are one undo step.
  private func restyle(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    if let editing = textEditor.style {
      interaction.styles.shared = change.applied(to: interaction.styles.shared)
      textEditor.setStyle(change.applied(to: editing))
    } else {
      interaction.apply(change, burst: burst)
      focusCanvas()
    }
    refresh()
  }

  /// `[` `-` and `]` `=`: one wheel notch smaller or larger (PixPin's keys for a wheel), one undo
  /// step each, for whatever the style bar targets; none at either end. False when the bar
  /// shows no size.
  private func stepStroke(_ direction: Int) -> Bool {
    resize(by: Double(direction), burst: nil)
  }

  /// The scroll wheel anywhere over the overlay while the style bar shows a size, as in PixPin:
  /// the same as dragging the size slider, one ``AnnotationStroke/stepped(by:)`` step per wheel
  /// notch (or per 20 pt of trackpad travel), up for larger. A run of ticks no more than half a second apart, or one trackpad
  /// gesture, is one undo step; momentum after a flick is ignored, so the size stops where the
  /// fingers did. False when there is no size to change, so the session keeps the wheel.
  func scroll(_ event: NSEvent) -> Bool {
    guard styleTarget?.controls.contains(.strokes) == true else { return false }
    guard event.momentumPhase.isEmpty else { return true }
    if event.phase == .began || (event.phase.isEmpty && event.timestamp - lastWheel > 0.5) {
      wheelBurst = UUID()
    }
    lastWheel = event.timestamp
    // Physical direction: up is larger whether or not scrolling is natural.
    let delta = event.isDirectionInvertedFromDevice ? -event.scrollingDeltaY : event.scrollingDeltaY
    let steps = event.hasPreciseScrollingDeltas ? delta / 20 : delta
    if steps != 0 { resize(by: Double(steps), burst: wheelBurst) }
    return true
  }

  /// Moves the size `steps` steps (``AnnotationStroke/stepped(by:)``).
  private func resize(by steps: Double, burst: UUID?) -> Bool {
    guard let target = styleTarget, target.controls.contains(.strokes) else { return false }
    let stroke = target.style.stroke.stepped(by: steps)
    if stroke != target.style.stroke {
      restyle(AnnotationStyleChange(stroke: stroke), burst: burst)
    }
    return true
  }

  /// ⌘Delete: open text is committed first, then the whole document goes as one undo step.
  /// False when there was neither text nor an annotation.
  private func clearAll() -> Bool {
    let wasEditing = textEditor.isEditing
    textEditor.end()
    let cleared = interaction.clearAll()
    refreshPointer()
    return wasEditing || cleared
  }

  /// Text opens in the canvas that was pressed, so it shows on the display being typed on.
  private func editText(at point: CGPoint, _ existing: Annotation?) {
    guard let canvas = pressedCanvas ?? canvases.first else { return }
    textEditor.begin(at: point, editing: existing, style: interaction.styles.shared, in: canvas)
  }

  /// Open text is committed first, so the export includes it.
  private func confirm() {
    textEditor.end()
    onConfirm?()
  }

  /// The same export as ``confirm()``, for the clipboard.
  private func copy() {
    textEditor.end()
    onCopy?()
  }

  private func refresh() {
    redraw()
    toolbar.update(
      tool: interaction.tool, canUndo: store.undoManager.canUndo,
      canRedo: store.undoManager.canRedo)
    if let target = styleTarget {
      styleBar.update(style: target.style, controls: target.controls)
      styleBar.isHidden = false
    } else {
      styleBar.isHidden = true
    }
    placeToolbar()
  }

  /// What the style bar restyles: the open text, else the selected annotation, else the next one
  /// the active drawing tool makes; nil when there is nothing to style (no tool, the select tool
  /// with nothing selected, or a spotlight), which hides the bar.
  private var styleTarget: (style: AnnotationStyle, controls: AnnotationStyleControls)? {
    let target: (style: AnnotationStyle, controls: AnnotationStyleControls)
    if let style = textEditor.style {
      target = (style, AnnotationTool.text.styleControls)
    } else if let selected = store.selected {
      target = (selected.style, selected.shape.styleControls)
    } else if let tool = interaction.tool {
      target = (interaction.styles[tool.styleSlot], tool.styleControls)
    } else {
      return nil
    }
    let controls = target.controls.shown(for: target.style)
    return controls.isEmpty ? nil : (target.style, controls)
  }
}
