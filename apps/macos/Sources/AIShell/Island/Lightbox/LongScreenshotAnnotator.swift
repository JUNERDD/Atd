import AICore
import AppKit
import Observation
import SwiftUI

/// Annotating the long screenshot in its lightbox (the spec's annotate mode): the screenshot
/// editor's tools, styles and undo on the whole image, in image points, with what is drawn kept
/// on the card as it is made. It is the editor's own pieces (``AnnotationStore``,
/// ``AnnotationInteraction``, ``AnnotationTextEditor``, ``AnnotationCanvasView`` drawing with
/// ``AnnotationRenderer``, ``AnnotationToolbar`` and ``AnnotationStyleBar``, styles remembered
/// with the editor's through ``AnnotationStyleMemory``) hosted over the image instead of over a
/// capture's selection: no element picking (an image has no interface elements), no command row
/// or ask field, and none of the session's own actions (the lightbox's bars have Copy and
/// Attach). Its contract with the lightbox's viewer:
///
/// - ``canvas`` covers the whole image: its frame is `(0, 0, w, h)` in image points with the
///   origin at the top-left, in a document view the viewer keeps at the image's point size and
///   scales by magnification, so the canvas and its text scale with the image. It always draws
///   the card's annotations; only while ``active`` does it take the pointer and, as the window's
///   first responder, the editor's keys (tool letters, Delete, arrows nudging the selected
///   annotation, `[` `]` `-` `=` stepping the size) and key equivalents (⌘Z, ⇧⌘Z, ⌘Delete),
///   which the viewer leaves to the responder chain: ``takesKey(_:)`` says which presses those
///   are now, and ⌘C stays the viewer's unless text is typed. Wheel and pinch events go on to
///   the scroll view. Inactive, it takes neither the pointer nor a key equivalent.
/// - ``bars`` are the editor's tool bar and, while something is styled, its style bar, side by
///   side at their own sizes on glass pinned dark, for the viewer to place at the top centre;
///   empty while inactive.
/// - ``stepBack()`` is Escape inside the editor; ``finish()`` ends open text and any gesture.
///   While ``isEditingText``, every key belongs to the text.
///
/// The card is the one place the annotations live: every change of the store goes there at once
/// (``IslandLongScreenshotCardModel/setAnnotations(_:)``), and a change made there by anything
/// else (Restore) comes back into the store, whose undo history then starts over. A new
/// annotator (the lightbox opened again) starts from the card's annotations. Text command
/// results land in the same store in every mode (``LongScreenshotAnnotator+Results``), so they
/// are undo steps and annotations like any other.
final class LongScreenshotAnnotator {
  let card: IslandLongScreenshotCardModel
  /// The surface the viewer places over the image (``LongScreenshotAnnotatorSurface``).
  let canvas: NSView
  /// Drawing (the pointer, the keyboard and the bars are the annotator's) or display only.
  var active = false {
    didSet { if active != oldValue { activeChanged() } }
  }
  /// Text is being typed: the lightbox leaves every key to it.
  var isEditingText: Bool { textEditor.isEditing }

  let store = AnnotationStore()
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  let toolbar = AnnotationToolbar()
  let styleBar = AnnotationStyleBar()
  let styleCoordinator: CaptureAnnotationStyleCoordinator
  /// The editor's canvas, filling ``canvas``.
  let drawing: AnnotationCanvasView
  private let surface: LongScreenshotAnnotatorSurface
  private let barsModel = LongScreenshotAnnotatorBarsModel()
  private let hover: LongScreenshotAnnotatorHover
  /// Keeps the remembered styles, shared with the screenshot editor's.
  let defaults: UserDefaults
  /// The store's document or its undo state changed, after the card took it.
  var onChange: () -> Void = {}
  private(set) var refreshRevision: UInt64 = 0
  var isBurstRestyling = false
  var pendingStylesSave: AnnotationStyles?
  var pendingStylesFlushScheduled = false
  var pendingCardSync = false
  var pendingCardFlushScheduled = false
  var lastCardAnnotations = AnnotationDocument()
  var lastToolbarState: (tool: AnnotationTool?, canUndo: Bool, canRedo: Bool)?
  var unmaskedSensitiveCache:
    (mosaics: [CGRect], sensitive: [SensitiveText.Box], uncovered: [SensitiveText.Box])?

  /// `defaults` keeps the remembered styles, shared with the screenshot editor's.
  init(card: IslandLongScreenshotCardModel, defaults: UserDefaults = .standard) {
    self.card = card
    self.defaults = defaults
    let shot = card.source.shot
    let image = CGRect(origin: .zero, size: shot.pointSize)
    interaction = AnnotationInteraction(store: store)
    interaction.selectionBounds = image
    textEditor = AnnotationTextEditor(store: store)
    styleCoordinator = CaptureAnnotationStyleCoordinator(
      store: store, interaction: interaction, textEditor: textEditor,
      styleBar: styleBar, defaults: defaults)
    drawing = AnnotationCanvasView(
      store: store, interaction: interaction, textEditor: textEditor,
      renderer: AnnotationRenderer(), picker: AnnotationElementPicker())
    drawing.backdrop = CaptureBackdrop(
      image: shot.image, scale: shot.scale, origin: .zero, frames: [image])
    surface = LongScreenshotAnnotatorSurface(frame: image)
    drawing.place(over: image)
    drawing.autoresizingMask = [.width, .height]
    surface.addSubview(drawing)
    canvas = surface
    toolbar.hideSessionControls()
    // Over the lightbox's dark scrim, as its own bars are.
    toolbar.pinDark()
    styleBar.pinDark()
    hover = LongScreenshotAnnotatorHover(bars: [toolbar, styleBar])
    store.load(card.state.annotations)
    lastCardAnnotations = store.document
    wire()
    observeCard()
    refresh()
  }

  /// How wide ``bars`` stand now: the tool bar, and the style bar beside it while it shows.
  var barsWidth: CGFloat {
    barsModel.toolbar.width
      + (barsModel.styleBar.map { LongScreenshotAnnotatorBars.gap + $0.width } ?? 0)
  }

  var bars: AnyView {
    AnyView(LongScreenshotAnnotatorBars(model: barsModel, toolbar: toolbar, styleBar: styleBar))
  }

  /// Escape: steps back one level (open text, a gesture in progress, the selection, the tool), as
  /// the editor does; false with nothing to step back, so the lightbox leaves annotate mode.
  func stepBack() -> Bool {
    if styleCoordinator.dismissPickers() { return true }
    if textEditor.isEditing {
      textEditor.end()
    } else if interaction.eyedropperActive {
      styleCoordinator.setEyedropper(false)
    } else if interaction.isGesturing {
      interaction.cancelGesture()
    } else if !store.selectedIDs.isEmpty {
      store.selectedIDs = []
    } else if interaction.tool != nil {
      choose(nil)
    } else {
      return false
    }
    refreshPointer()
    return true
  }

  /// Ends open text, keeping it, and drops a gesture in progress: annotate mode ends, or the
  /// lightbox closes.
  func finish() {
    styleCoordinator.dismissPickers()
    styleCoordinator.setEyedropper(false)
    textEditor.end()
    interaction.cancelGesture()
    flushPendingBurstWork()
  }

  // MARK: Wiring

  private func wire() {
    store.onChange = { [weak self] in self?.refresh() }
    store.onUndoRedo = { [weak self] in self?.styleBar.endRedactionFeedback() }
    interaction.onStylesChange = { [weak self] styles in self?.handleStylesChange(styles) }
    interaction.onEditText = { [weak self] point, existing in
      guard let self else { return }
      textEditor.begin(
        at: point, editing: existing, style: interaction.styles.shared, in: drawing)
    }
    interaction.onBeginTextBox = { [weak self] point, width in
      guard let self else { return }
      textEditor.begin(
        at: point, boxWidth: width, editing: nil, style: interaction.styles.shared, in: drawing)
      refresh()
    }
    interaction.onSmartShapeSnapped = { [weak self] label in self?.drawing.showSizeHud(label) }
    styleCoordinator.onRedraw = { [weak self] in self?.drawing.needsDisplay = true }
    styleCoordinator.onRefresh = { [weak self] in self?.refresh() }
    styleCoordinator.onRefreshPointer = { [weak self] in self?.refreshPointer() }
    styleCoordinator.onApplyStyle = { [weak self] change, burst in
      self?.restyle(change, burst: burst)
    }
    styleCoordinator.onBurstEnd = { [weak self] in self?.flushPendingBurstWork() }
    styleCoordinator.onSpotlightDim = { [weak self] dim, burst in
      self?.setSpotlightDim(dim, burst: burst)
    }
    textEditor.onEnd = { [weak self] in self?.focusCanvas() }
    toolbar.onTool = { [weak self] in self?.choose($0) }
    toolbar.onUndo = { [weak self] in self?.store.undo() }
    toolbar.onRedo = { [weak self] in self?.store.redo() }
    styleBar.onChange = { [weak self] in self?.restyle($0, burst: $1) }
    styleBar.onRedact = { [weak self] in self?.redactSensitive() }
    styleCoordinator.wireCanvas(drawing)
    drawing.onChooseTool = { [weak self] in self?.choose($0) }
    drawing.onEscape = { [weak self] in self?.stepBack() ?? false }
    drawing.onStepStroke = { [weak self] in self?.stepStroke($0) ?? false }
    drawing.onClearAll = { [weak self] in self?.clearAll() ?? false }
    surface.onWindow = { [weak self] in self?.focusCanvas() }
  }

  /// Follows the card's state: annotations it changed itself come into the store, and the
  /// sensitive items the kept range shows reach auto-redact.
  private func observeCard() {
    withObservationTracking {
      _ = card.state
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self else { return }
        if adoptCard() { refresh() } else { refreshRedaction() }
        observeCard()
      }
    }
  }

  /// Takes the card's annotations when they are not the store's, which only a change made
  /// elsewhere leaves: open text and a gesture go, and undo starts over. False when they were.
  @discardableResult
  private func adoptCard() -> Bool {
    let document = card.state.annotations
    if pendingCardSync, document == lastCardAnnotations { return false }
    guard document != store.document else {
      lastCardAnnotations = document
      return false
    }
    pendingCardSync = false
    lastCardAnnotations = document
    textEditor.cancel()
    interaction.cancelGesture()
    store.load(document)
    return true
  }

  // MARK: State

  private func activeChanged() {
    flushPendingBurstWork()
    // The cursor the canvas set would otherwise outlast drawing under a still pointer.
    let releasesCursor = !active && surface.isUnderPointer
    surface.isActive = active
    barsModel.shown = active
    if active {
      adoptCard()
      interaction.styles = AnnotationStyleMemory.load(from: defaults)
      toolbar.applyStrings()
      styleBar.applyStrings()
      styleCoordinator.activateFontObserver()
      focusCanvas()
    } else {
      CaptureFontCatalog.shared.onFontRegistered = nil
      finish()
      store.selectedIDs = []
      if let window = drawing.window, let responder = window.firstResponder as? NSView,
        responder.isDescendant(of: surface)
      {
        window.makeFirstResponder(nil)
      }
    }
    refresh()
    refreshPointer()
    if releasesCursor { NSCursor.arrow.set() }
  }

  /// Everything shown follows the store, and the card takes its document.
  func refresh() {
    refreshRevision &+= 1
    drawing.needsDisplay = true
    let toolbarState = (
      tool: interaction.tool, canUndo: store.undoManager.canUndo,
      canRedo: store.undoManager.canRedo
    )
    let toolbarChanged =
      lastToolbarState.map {
        $0.tool != toolbarState.tool || $0.canUndo != toolbarState.canUndo
          || $0.canRedo != toolbarState.canRedo
      } ?? true
    if toolbarChanged {
      lastToolbarState = toolbarState
      toolbar.update(
        tool: toolbarState.tool, canUndo: toolbarState.canUndo,
        canRedo: toolbarState.canRedo)
      hover.refresh()
    }
    let target = active ? styleTarget : nil
    if let target { styleCoordinator.syncStyleBar(target) }
    refreshRedaction()
    barsModel.update(
      toolbar: toolbar.fittingSize, styleBar: target == nil ? nil : styleBar.fittingSize)
    if store.document != card.state.annotations {
      if isBurstRestyling {
        scheduleCardSync()
      } else {
        pendingCardSync = false
        lastCardAnnotations = store.document
        card.setAnnotations(store.document)
      }
    } else {
      pendingCardSync = false
      lastCardAnnotations = store.document
    }
    onChange()
  }

  /// What the style bar restyles: the open text, else the selected annotation(s), else the next one
  /// the active drawing tool makes; nil when there is nothing to style, which hides the bar.
  var styleTarget: (style: AnnotationStyle, controls: AnnotationStyleControls)? {
    styleCoordinator.styleTarget()
  }

  /// The keyboard goes to the canvas while drawing, unless text has it.
  func focusCanvas() {
    guard active, !textEditor.isEditing, let window = drawing.window,
      window.firstResponder !== drawing
    else { return }
    window.makeFirstResponder(drawing)
  }

  /// The tool or the selection changed: the cursor follows at once under a still pointer.
  func refreshPointer() {
    guard active else { return }
    drawing.refreshPointer()
  }
}
