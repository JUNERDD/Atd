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
/// annotator (the lightbox opened again) starts from the card's annotations.
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
  /// The editor's canvas, filling ``canvas``.
  let drawing: AnnotationCanvasView
  private let surface: LongScreenshotAnnotatorSurface
  private let barsModel = LongScreenshotAnnotatorBarsModel()
  private let hover: LongScreenshotAnnotatorHover
  private let defaults: UserDefaults

  /// `defaults` keeps the remembered styles, shared with the screenshot editor's.
  init(card: IslandLongScreenshotCardModel, defaults: UserDefaults = .standard) {
    self.card = card
    self.defaults = defaults
    let shot = card.source.shot
    let image = CGRect(origin: .zero, size: shot.pointSize)
    interaction = AnnotationInteraction(store: store)
    textEditor = AnnotationTextEditor(store: store)
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

  /// Ends open text, keeping it, and drops a gesture in progress: annotate mode ends, or the
  /// lightbox closes.
  func finish() {
    textEditor.end()
    interaction.cancelGesture()
  }

  // MARK: Wiring

  private func wire() {
    store.onChange = { [weak self] in self?.refresh() }
    store.onUndoRedo = { [weak self] in self?.styleBar.endRedactionFeedback() }
    interaction.onStylesChange = { [weak self] styles in
      guard let self else { return }
      AnnotationStyleMemory.save(styles, to: defaults)
    }
    interaction.onEditText = { [weak self] point, existing in
      guard let self else { return }
      textEditor.begin(
        at: point, editing: existing, style: interaction.styles.shared, in: drawing)
    }
    textEditor.onEnd = { [weak self] in self?.focusCanvas() }
    toolbar.onTool = { [weak self] in self?.choose($0) }
    toolbar.onUndo = { [weak self] in self?.store.undo() }
    toolbar.onRedo = { [weak self] in self?.store.redo() }
    styleBar.onChange = { [weak self] in self?.restyle($0, burst: $1) }
    styleBar.onRedact = { [weak self] in self?.redactSensitive() }
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
    guard document != store.document else { return false }
    textEditor.cancel()
    interaction.cancelGesture()
    store.load(document)
    return true
  }

  // MARK: State

  private func activeChanged() {
    // The cursor the canvas set would otherwise outlast drawing under a still pointer.
    let releasesCursor = !active && surface.isUnderPointer
    surface.isActive = active
    barsModel.shown = active
    if active {
      adoptCard()
      interaction.styles = AnnotationStyleMemory.load(from: defaults)
      toolbar.applyStrings()
      styleBar.applyStrings()
      focusCanvas()
    } else {
      finish()
      store.selectedID = nil
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
    drawing.needsDisplay = true
    toolbar.update(
      tool: interaction.tool, canUndo: store.undoManager.canUndo,
      canRedo: store.undoManager.canRedo)
    let target = active ? styleTarget : nil
    if let target { styleBar.update(style: target.style, controls: target.controls) }
    refreshRedaction()
    barsModel.update(
      toolbar: toolbar.fittingSize, styleBar: target == nil ? nil : styleBar.fittingSize)
    hover.refresh()
    if store.document != card.state.annotations { card.setAnnotations(store.document) }
  }

  /// What the style bar restyles: the open text, else the selected annotation, else the next one
  /// the active drawing tool makes; nil when there is nothing to style, which hides the bar.
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

  /// The keyboard goes to the canvas while drawing, unless text has it.
  func focusCanvas() {
    guard active, !textEditor.isEditing, let window = drawing.window else { return }
    window.makeFirstResponder(drawing)
  }

  /// The tool or the selection changed: the cursor follows at once under a still pointer.
  func refreshPointer() {
    guard active else { return }
    drawing.refreshPointer()
  }
}
