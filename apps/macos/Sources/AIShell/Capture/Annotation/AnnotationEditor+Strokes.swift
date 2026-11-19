import AICore
import AppKit

/// What changes the style and the size of what the style bar targets, and clears the whole
/// document: the bar itself, the scroll wheel and the keys that step the size.
extension AnnotationEditor {
  /// A style bar change: it restyles the open text, else the selected annotation, and becomes
  /// the style of the next new annotation of the same slot. Only the part picked changes.
  /// Changes sharing a `burst` (a size slider drag, a run of wheel ticks) are one undo step.
  func restyle(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    if let editing = textEditor.style {
      let nextShared = change.applied(to: interaction.styles.shared)
      let nextEditing = change.applied(to: editing)
      guard nextShared != interaction.styles.shared || nextEditing != editing else { return }
      withBurstRestyle(burst != nil) {
        if nextShared != interaction.styles.shared { interaction.styles.shared = nextShared }
        if nextEditing != editing { textEditor.setStyle(nextEditing) }
      }
      refresh()
      return
    }
    let selected = store.selectedAnnotations
    if selected.isEmpty {
      let slot = interaction.tool?.styleSlot ?? .shared
      guard change.applied(to: interaction.styles[slot]) != interaction.styles[slot] else { return }
    } else {
      let slot = selected[0].shape.styleSlot
      let slotChanged = change.applied(to: interaction.styles[slot]) != interaction.styles[slot]
      let itemsChanged = selected.contains { change.applied(to: $0.style) != $0.style }
      guard slotChanged || itemsChanged else { return }
    }
    let before = refreshRevision
    prepareLocalizedRestyle(selected: selected)
    defer { clearLocalizedRestyle() }
    withBurstRestyle(burst != nil) {
      interaction.apply(change, burst: burst)
      focusCanvas()
    }
    if refreshRevision == before { refresh() }
  }

  /// `[` `-` and `]` `=`: one wheel notch smaller or larger (PixPin's keys for a wheel), one undo
  /// step each, for whatever the style bar targets; none at either end. False when the bar
  /// shows no size.
  func stepStroke(_ direction: Int) -> Bool {
    resize(by: Double(direction), burst: nil)
  }

  /// The scroll wheel anywhere over the overlay while the style bar shows a size or spotlight
  /// opacity: steplessly adjusts size or dim using ``CaptureSliderWheel`` and groups contiguous
  /// ticks into one undo step; momentum after a flick is ignored. False when there is nothing to
  /// adjust, so the session keeps the wheel.
  func scroll(_ event: NSEvent) -> Bool {
    guard let target = styleTarget else { return false }
    let hasStrokes = target.controls.contains(.strokes)
    let hasDim = target.controls.contains(.spotlightDim)
    guard hasStrokes || hasDim else { return false }
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return true
    case .delta(let unit):
      let burst = wheelBurst.next(for: event) { [weak self] in self?.flushPendingStyles() }
      if hasStrokes {
        resizeContinuous(by: unit, burst: burst)
        if let label = styleCoordinator.currentSizeLabel() { showCanvasHUD(label) }
      } else {
        let nextDim = min(max(store.shown.spotlightDim + CGFloat(unit) * 0.60, 0.25), 0.85)
        if abs(nextDim - store.shown.spotlightDim) > 1e-6 {
          store.setSpotlightDim(nextDim, burst: burst)
        }
        let pct = Int((store.shown.spotlightDim * 100).rounded())
        showCanvasHUD(ShellStrings.shared.text(CaptureToolsStringKey.opacityPercent, count: pct))
      }
      return true
    }
  }

  /// Opens a fixed-width text box dragged by the text tool on the active display's canvas.
  func beginTextBox(at point: CGPoint, width: CGFloat?) {
    guard let canvas = pressedCanvas ?? barCanvas ?? canvases.first else { return }
    textEditor.begin(
      at: point, boxWidth: width, editing: nil, style: interaction.styles.shared, in: canvas)
    refresh()
  }

  /// Shows a transient HUD message (size step, smart-shape snap) on the active canvas.
  func showCanvasHUD(_ text: String) {
    (pressedCanvas ?? barCanvas ?? canvases.first)?.showSizeHud(text)
  }

  /// Copies currently selected Live Text characters/paragraphs only when Live Text holds a pick.
  func copySelectedLiveTextIfPresent() -> Bool {
    guard text.mode.selection != nil else { return false }
    copySelectedText(fromKey: true)
    return true
  }

  private func resizeContinuous(by unit: Double, burst: UUID?) {
    guard let target = styleTarget, target.controls.contains(.strokes) else { return }
    let stroke = AnnotationStroke(target.style.stroke.value + unit)
    if stroke != target.style.stroke {
      restyle(AnnotationStyleChange(stroke: stroke), burst: burst)
    }
  }

  /// Moves the size `steps` steps (``AnnotationStroke/stepped(by:)``); false when the style bar
  /// shows no size, so the key or the wheel goes on to the session.
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
  func clearAll() -> Bool {
    let wasEditing = textEditor.isEditing
    textEditor.end()
    let cleared = interaction.clearAll()
    refreshPointer()
    return wasEditing || cleared
  }
}

/// Shared coordinator for ``AnnotationEditor`` and ``LongScreenshotAnnotator``: drives color and
/// font popovers, eyedropper sampling, spotlight/step config, Tab cycling, and size HUD formatting.
@MainActor
final class CaptureAnnotationStyleCoordinator {
  let colorPopover = CaptureColorPickerPopover()
  let fontPopover = CaptureFontPickerPopover()
  let cornerPopover = CaptureCornerRadiusPopover()
  let store: AnnotationStore
  let interaction: AnnotationInteraction
  let textEditor: AnnotationTextEditor
  let styleBar: AnnotationStyleBar
  let defaults: UserDefaults
  var cornerRadiusHUDCanvases: [WeakCornerHUDCanvas] = []

  var onRedraw: () -> Void = {}
  var onRefresh: () -> Void = {}
  var onRefreshPointer: () -> Void = {}
  var onApplyStyle: (AnnotationStyleChange, UUID?) -> Void = { _, _ in }
  var onBurstEnd: (() -> Void)?
  var onSpotlightDim: ((CGFloat, UUID?) -> Void)?
  var onDismissTransientMenus: () -> Void = {}

  init(
    store: AnnotationStore,
    interaction: AnnotationInteraction,
    textEditor: AnnotationTextEditor,
    styleBar: AnnotationStyleBar,
    defaults: UserDefaults
  ) {
    self.store = store
    self.interaction = interaction
    self.textEditor = textEditor
    self.styleBar = styleBar
    self.defaults = defaults
    configure()
  }

  var hasOpenPopover: Bool { colorPopover.isShown || fontPopover.isShown || cornerPopover.isShown }

  @discardableResult
  func dismissPickers() -> Bool {
    let wasOpen = hasOpenPopover
    fontPopover.dismissPopover()
    colorPopover.dismissPopover()
    cornerPopover.dismissPopover()
    return wasOpen
  }

  func activateFontObserver() {
    CaptureFontCatalog.shared.onFontRegistered = { [weak self] family in
      guard let self else { return }
      interaction.refitTexts(forFontFamily: family)
      textEditor.refreshLayout()
      onRedraw()
    }
  }

  func wireCanvas(_ canvas: AnnotationCanvasView) {
    trackCornerHUDCanvas(canvas)
    canvas.onTab = { [weak self] reverse in self?.cycleSelection(reverse: reverse) ?? false }
    canvas.onToggleEyedropper = { [weak self] in self?.toggleEyedropper() }
    canvas.onSampleColor = { [weak self] rgba, commit in
      self?.handleSampledColor(rgba, commit: commit)
    }
    canvas.onStepSizeHUD = { [weak self] in self?.currentSizeLabel() }
  }

  func styleTarget() -> (style: AnnotationStyle, controls: AnnotationStyleControls)? {
    let target: (style: AnnotationStyle, controls: AnnotationStyleControls)
    if let style = textEditor.style {
      target = (style, AnnotationTool.text.styleControls)
    } else {
      let selected = store.selectedAnnotations
      if selected.count == 1, let single = selected.first {
        target = (single.style, single.shape.styleControls)
      } else if selected.count > 1 {
        var shared = selected[0].shape.styleControls.shown(for: selected[0].style)
        for item in selected.dropFirst() {
          shared.formIntersection(item.shape.styleControls.shown(for: item.style))
        }
        if selected.contains(where: { $0.shape.styleControls.contains(.colors) }) {
          shared.insert(.colors)
        }
        if selected.contains(where: { $0.shape.styleControls.contains(.strokes) }) {
          shared.insert(.strokes)
        }
        target = (selected[0].style, shared)
      } else if let tool = interaction.tool {
        target = (interaction.styles[tool.styleSlot], tool.styleControls)
      } else {
        return nil
      }
    }
    let controls = target.controls.shown(for: target.style)
    return controls.isEmpty ? nil : (target.style, controls)
  }

  func syncStyleBar(_ target: (style: AnnotationStyle, controls: AnnotationStyleControls)) {
    styleBar.eyedropperActive = interaction.eyedropperActive
    styleBar.spotlightDimValue = store.shown.spotlightDim
    styleBar.stepFormatValue = store.shown.stepFormat
    styleBar.stepStartIndexValue = store.shown.stepStartIndex
    styleBar.update(style: target.style, controls: target.controls)
    syncCornerPopover(with: target)
  }

  func toggleEyedropper() { setEyedropper(!interaction.eyedropperActive) }

  func setEyedropper(_ active: Bool) {
    guard interaction.eyedropperActive != active else { return }
    interaction.eyedropperActive = active
    if !active { interaction.hoveredRGBA = nil }
    styleBar.eyedropperActive = active
    onRefresh()
    onRedraw()
    onRefreshPointer()
  }

  func currentSizeLabel() -> String? {
    guard let style = styleTarget()?.style else { return nil }
    let prefix = ShellStrings.shared.text(CaptureToolsStringKey.sizePrefix)
    let shape = store.selected?.shape
    if interaction.tool == .text || textEditor.isEditing || store.selected?.isText == true {
      return "\(prefix): \(Int(style.textFontSize.rounded())) pt"
    }
    if case .mosaic = shape {
      return mosaicSizeLabel(prefix: prefix, style: style)
    }
    if case .mosaicBrush = shape {
      return mosaicSizeLabel(prefix: prefix, style: style)
    }
    if interaction.tool == .mosaic {
      return mosaicSizeLabel(prefix: prefix, style: style)
    }
    var isStepSelected = false
    if case .step = shape { isStepSelected = true }
    if interaction.tool == .step || isStepSelected {
      return "\(prefix): \(Int(style.stroke.stepDiameter.rounded())) pt"
    }
    if interaction.tool == .highlighter || shape?.styleSlot == .highlighter {
      return "\(prefix): \(String(format: "%.1f", style.stroke.highlighterWidth)) pt"
    }
    return "\(prefix): \(String(format: "%.1f", style.stroke.lineWidth)) pt"
  }

  private func mosaicSizeLabel(prefix: String, style: AnnotationStyle) -> String {
    style.redaction == .blur
      ? "\(prefix): \(Int(style.stroke.blurRadius.rounded())) px"
      : "\(prefix): \(Int(style.stroke.mosaicBlock.rounded())) px"
  }

  private func cycleSelection(reverse: Bool) -> Bool {
    let list = store.document.annotations
    guard !list.isEmpty else { return false }
    let nextIdx: Int
    if let current = store.selectedID, let idx = list.firstIndex(where: { $0.id == current }) {
      nextIdx = (idx + (reverse ? -1 : 1) + list.count) % list.count
    } else {
      nextIdx = reverse ? list.count - 1 : 0
    }
    store.selectedID = list[nextIdx].id
    onRefresh()
    onRedraw()
    return true
  }

  private func handleSampledColor(_ rgba: AnnotationRGBA, commit: Bool) {
    guard commit else { return }
    onApplyStyle(AnnotationStyleChange(customColor: .some(rgba)), nil)
    AnnotationStyleMemory.recordRecentColor(rgba, to: defaults)
    colorPopover.recentColors = AnnotationStyleMemory.loadRecentColors(from: defaults)
    setEyedropper(false)
  }
}
