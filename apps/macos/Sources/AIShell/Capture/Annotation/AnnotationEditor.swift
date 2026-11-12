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
  var onLaunch: ((CaptureLaunch) -> Void)?
  var commandRow: CaptureCommandRowSetup? {
    didSet {
      guard let commandRow, !canvases.isEmpty else { return }
      slot.updateCursor(commandRow.cursor, app: commandRow.cursorApp)
      text.card.insertApp = commandRow.cursorApp
      if text.card.presentation == .card { refreshCard() }
    }
  }
  var keepClear = AnnotationToolbarLayout.KeepClear()
  var renderSelection: (() -> CaptureSelectionShot?)?
  var onTextResult: ((CaptureTextHandoff) -> Void)?
  var recognizedText: CaptureText? {
    didSet { recognizedTextChanged() }
  }

  let store = AnnotationStore()
  private let renderer = AnnotationRenderer()
  private let picker = AnnotationElementPicker()
  private let defaults: UserDefaults
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  /// One per host, in the hosts' order; empty while hidden.
  private(set) var canvases: [AnnotationCanvasView] = []
  /// The canvas pressed last, which new text opens in.
  private weak var pressedCanvas: AnnotationCanvasView?
  let toolbar = AnnotationToolbar()
  let styleBar = AnnotationStyleBar()
  /// The style bar's slot while nothing is styled: the command row or its ask field.
  let slot = AnnotationCommandSlot()
  /// Text mode, the text commands' runs and their result card.
  let text = CaptureTextSession()

  /// What mosaics sample for a selection (the session's), and its answer for the current one.
  private var backdrops: ((CGRect) -> CaptureBackdrop?)?
  private(set) var backdrop: CaptureBackdrop?
  private(set) var selection = CGRect.zero
  /// Where the user dragged the toolbar to, in desktop points: it stays there while the bars
  /// stay on the same display, whatever the selection does. Nil while the bars follow the
  /// selection.
  var movedOrigin: CGPoint?
  /// Where the rule last put the bars beside the selection, which they hold while it is dragged
  /// (``isDragged``).
  var anchor: AnnotationToolbarLayout.Anchor?
  /// The selection is being dragged (``selectionDidChange(_:dragging:)``).
  private(set) var isDragged = false
  /// The run of wheel ticks in progress (``scroll(_:)``) and when its last tick came.
  var wheelBurst = UUID()
  var lastWheel: TimeInterval = 0
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
    interaction.onConfirm = { [weak self] in self?.onConfirm?() }
    textEditor.onEnd = { [weak self] in
      self?.focusCanvas()
      self?.landWaiting()
    }
    toolbar.onTool = { [weak self] in self?.choose($0) }
    styleBar.onChange = { [weak self] in self?.restyle($0, burst: $1) }
    toolbar.onUndo = { [weak self] in self?.store.undo() }
    toolbar.onRedo = { [weak self] in self?.store.redo() }
    toolbar.onCancel = { [weak self] in self?.onCancel?() }
    toolbar.onConfirm = { [weak self] in self?.onConfirm?() }
    toolbar.onCopy = { [weak self] in self?.onCopy?() }
    toolbar.onDrag = { [weak self] in self?.moveBars($0) }
    styleBar.onDrag = { [weak self] in self?.moveBars($0) }
    wireCommands()
    wireText()
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
    slot.prepare(commandRow, maxWidth: toolbar.fittingSize.width)
    canvases = hosts.map { host in
      let canvas = makeCanvas()
      host.addSubview(canvas)
      return canvas
    }
    selectionDidChange(selection, dragging: false)
    refresh()
    focusCanvas()
  }

  /// A canvas wired to the shared document, interaction and actions.
  private func makeCanvas() -> AnnotationCanvasView {
    let canvas = AnnotationCanvasView(
      store: store, interaction: interaction, textEditor: textEditor, renderer: renderer,
      picker: picker)
    canvas.onPress = { [weak self, weak canvas] in self?.pressedCanvas = canvas }
    canvas.onConfirm = { [weak self] in self?.confirmFromKey() }
    canvas.onCopy = { [weak self] in self?.copyFromKey() }
    canvas.onSelectAll = { [weak self] in self?.selectAllFromKey() ?? false }
    canvas.onPrimary = { [weak self] in self?.text.card.primaryKey() ?? false }
    canvas.onGestureEnd = { [weak self] in self?.landWaiting() }
    canvas.pointerOwner = self
    canvas.onChooseTool = { [weak self] in self?.choose($0) }
    canvas.onEscape = { [weak self] in self?.stepBack() ?? false }
    canvas.onAsk = { [weak self] in self?.slot.askFromKey() ?? false }
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

  func selectionDidChange(_ selection: CGRect, dragging: Bool) {
    self.selection = selection
    isDragged = dragging
    // A selection moving onto another display, or across displays, samples other pixels.
    let backdrop = backdrops?(selection)
    let changed = backdrop?.image !== self.backdrop?.image
    self.backdrop = backdrop
    for canvas in canvases {
      if changed { canvas.backdrop = backdrop }
      canvas.place(over: selection)
    }
    textEditor.selectionDidChange()
    endFeedback()
    placeToolbar()
    placeCard()
  }

  func endText() { textEditor.end() }

  func hide() {
    interaction.cancelGesture()
    textEditor.cancel()
    releaseText()
    slot.hide()
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
  /// interior back. A tool ends text mode, whose picks and selection go.
  func choose(_ tool: AnnotationTool?) {
    textEditor.end()
    toolChanged()
    interaction.cancelGesture()
    if tool != nil, text.mode.isOn { text.mode.set(on: false) }
    interaction.tool = tool
    updateClaim()
    refreshPointer()
    refresh()
    focusCanvas()
  }

  /// Tells the session whether the interior is the editor's: while a tool is chosen or text
  /// mode is on.
  func updateClaim() {
    let claims = interaction.tool != nil || text.mode.isOn
    guard claims != text.claimed else { return }
    text.claimed = claims
    onInteriorClaimChange?(claims)
  }

  /// Text opens in the canvas that was pressed, so it shows on the display being typed on.
  private func editText(at point: CGPoint, _ existing: Annotation?) {
    guard let canvas = pressedCanvas ?? canvases.first else { return }
    textEditor.begin(at: point, editing: existing, style: interaction.styles.shared, in: canvas)
  }

  func refresh() {
    redraw()
    toolbar.update(
      tool: interaction.tool, canUndo: store.undoManager.canUndo,
      canRedo: store.undoManager.canRedo)
    refreshSlot()
    placeToolbar()
    refreshTextLayers()
    refreshCard()
  }

  /// What the style bar restyles: the open text, else the selected annotation, else the next one
  /// the active drawing tool makes; nil when there is nothing to style (no tool, the select tool
  /// with nothing selected, or a spotlight), which hides the bar.
  var styleTarget: (style: AnnotationStyle, controls: AnnotationStyleControls)? {
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
