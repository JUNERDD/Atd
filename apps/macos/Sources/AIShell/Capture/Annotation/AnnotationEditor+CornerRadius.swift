import AICore
import AppKit

/// Weak reference wrapper so ``CaptureAnnotationStyleCoordinator`` can target the active canvas HUD.
final class WeakCornerHUDCanvas {
  weak var canvas: AnnotationCanvasView?
  init(_ canvas: AnnotationCanvasView) { self.canvas = canvas }
}

extension CaptureAnnotationStyleCoordinator {
  func trackCornerHUDCanvas(_ canvas: AnnotationCanvasView) {
    cornerRadiusHUDCanvases.removeAll { $0.canvas == nil }
    guard !cornerRadiusHUDCanvases.contains(where: { $0.canvas === canvas }) else { return }
    cornerRadiusHUDCanvases.append(WeakCornerHUDCanvas(canvas))
  }

  func configureCornerRadiusPopover() {
    cornerPopover.maxRadius = 48
    styleBar.onOpenCornerRadius = { [weak self] anchor in
      self?.toggleCornerRadius(relativeTo: anchor)
    }
    cornerPopover.onChange = { [weak self] radius, burst in
      guard let self else { return }
      let continuous = radius < 0.25 ? 0 : min(max(0, (radius * 100).rounded() / 100), 48)
      let cornerStyle: AnnotationCornerStyle = continuous > 0 ? .rounded : .sharp
      let value: CGFloat? = continuous > 0 ? continuous : nil
      onApplyStyle(
        AnnotationStyleChange(cornerStyle: cornerStyle, cornerRadius: .some(value)), burst)
      cornerPopover.currentRadius = continuous
    }
    interaction.onCornerRadiusChanged = { [weak self] radius in
      self?.showCornerRadiusHUD(radius)
    }
  }

  func toggleCornerRadius(relativeTo anchor: NSView) {
    if cornerPopover.isShown {
      cornerPopover.dismissPopover()
      return
    }
    colorPopover.dismissPopover()
    fontPopover.dismissPopover()
    onDismissTransientMenus()
    cornerPopover.maxRadius = 48
    cornerPopover.currentRadius = styleTarget()?.style.displayCornerRadius ?? 0
    cornerPopover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
  }

  func syncCornerPopover(with target: (style: AnnotationStyle, controls: AnnotationStyleControls)) {
    guard cornerPopover.isShown else { return }
    guard target.controls.contains(.cornerStyle), !styleBar.cornerButtonAnchorView.isHidden else {
      cornerPopover.dismissPopover()
      return
    }
    if !cornerPopover.isDraggingSlider && !cornerPopover.isWheelBurstActive {
      cornerPopover.currentRadius = target.style.displayCornerRadius
    }
  }

  func configure() {
    configureCornerRadiusPopover()
    configureWheelAndBurst()
    styleBar.onOpenColorWheel = { [weak self] anchor in self?.toggleColorWheel(relativeTo: anchor) }
    styleBar.onOpenFontPicker = { [weak self] anchor in self?.toggleFontPicker(relativeTo: anchor) }
    styleBar.onEyedropper = { [weak self] active in self?.setEyedropper(active) }
    styleBar.onSpotlightDim = { [weak self] dim, burst in
      self?.applySpotlightDim(dim, burst: burst)
    }
    styleBar.onStepConfig = { [weak self] format, delta in
      self?.updateStepConfig(format: format, delta: delta)
    }
    fontPopover.activeFamiliesInDocument = { [weak self] in
      guard let self else { return [] }
      var families = Set(store.document.annotations.compactMap(\.style.fontFamily))
      if let active = textEditor.style?.fontFamily { families.insert(active) }
      return families
    }
    fontPopover.onSelectFont = { [weak self] choice in
      guard let self else { return }
      if let family = choice.familyName {
        AnnotationStyleMemory.recordRecentFont(family, to: defaults)
        fontPopover.recentFamilies = AnnotationStyleMemory.loadRecentFonts(from: defaults)
      }
      fontPopover.selectedFamily = choice.familyName
      onApplyStyle(AnnotationStyleChange(fontChoice: choice), nil)
    }
    colorPopover.onColorChange = { [weak self] rgba, burst in
      guard let self else { return }
      onApplyStyle(AnnotationStyleChange(customColor: .some(rgba)), burst)
      colorPopover.currentColor = rgba
    }
    colorPopover.onColorCommit = { [weak self] rgba in
      guard let self else { return }
      AnnotationStyleMemory.recordRecentColor(rgba, to: defaults)
      colorPopover.recentColors = AnnotationStyleMemory.loadRecentColors(from: defaults)
      onBurstEnd?()
    }
    colorPopover.onRequestEyedropper = { [weak self] in
      self?.colorPopover.dismissPopover()
      self?.setEyedropper(true)
    }
  }

  func configureWheelAndBurst() {
    styleBar.onSliderBurstEnd = { [weak self] in self?.onBurstEnd?() }
    cornerPopover.onBurstEnd = { [weak self] in self?.onBurstEnd?() }
    cornerPopover.onClose = { [weak self] in self?.onBurstEnd?() }
    colorPopover.onClose = { [weak self] in self?.onBurstEnd?() }
    styleBar.onScrollSize = { [weak self] unit, burst in
      guard let self, let target = styleTarget(), target.controls.contains(.strokes) else {
        return false
      }
      let stroke = AnnotationStroke(target.style.stroke.value + unit)
      if stroke != target.style.stroke {
        onApplyStyle(AnnotationStyleChange(stroke: stroke), burst)
      }
      if let label = currentSizeLabel() { activeCornerHUDCanvas()?.showSizeHud(label) }
      return true
    }
    styleBar.onScrollSpotlightDim = { [weak self] unit, burst in
      guard let self, let target = styleTarget(), target.controls.contains(.spotlightDim) else {
        return false
      }
      applySpotlightDim(store.shown.spotlightDim + CGFloat(unit) * 0.60, burst: burst)
      let pct = Int((store.shown.spotlightDim * 100).rounded())
      let label = ShellStrings.shared.text(CaptureToolsStringKey.opacityPercent, count: pct)
      activeCornerHUDCanvas()?.showSizeHud(label)
      return true
    }
  }

  func applySpotlightDim(_ dim: CGFloat, burst: UUID?) {
    let clamped = min(max(dim, 0.25), 0.85)
    guard abs(clamped - store.shown.spotlightDim) > 1e-6 else { return }
    if let onSpotlightDim {
      onSpotlightDim(clamped, burst)
    } else {
      store.setSpotlightDim(clamped, burst: burst)
    }
  }

  func toggleFontPicker(relativeTo anchor: NSView) {
    if fontPopover.isShown {
      fontPopover.dismissPopover()
      return
    }
    colorPopover.dismissPopover()
    cornerPopover.dismissPopover()
    onDismissTransientMenus()
    fontPopover.selectedFamily = styleTarget()?.style.fontFamily
    fontPopover.recentFamilies = AnnotationStyleMemory.loadRecentFonts(from: defaults)
    fontPopover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
  }

  func toggleColorWheel(relativeTo anchor: NSView) {
    if colorPopover.isShown {
      colorPopover.dismissPopover()
      return
    }
    fontPopover.dismissPopover()
    cornerPopover.dismissPopover()
    onDismissTransientMenus()
    colorPopover.currentColor = styleTarget()?.style.effectiveRGBA ?? AnnotationColor.red.rgba
    colorPopover.recentColors = AnnotationStyleMemory.loadRecentColors(from: defaults)
    colorPopover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .minY)
  }

  func updateStepConfig(format: AnnotationStepFormat?, delta: Int?) {
    var doc = store.document
    if let format { doc.stepFormat = format }
    if let delta { doc.stepStartIndex = max(1, doc.stepStartIndex + delta) }
    store.commit(doc)
  }

  func showCornerRadiusHUD(_ radius: CGFloat) {
    let label = ShellStrings.shared.text(
      CaptureToolsStringKey.cornerRadiusValue, count: Int(radius.rounded()))
    activeCornerHUDCanvas()?.showSizeHud(label)
  }

  private func activeCornerHUDCanvas() -> AnnotationCanvasView? {
    let live = cornerRadiusHUDCanvases.compactMap(\.canvas)
    let mouse = NSEvent.mouseLocation
    if let hovered = live.first(where: { canvas in
      guard let window = canvas.window else { return false }
      let local = canvas.convert(window.convertPoint(fromScreen: mouse), from: nil)
      return canvas.bounds.contains(local)
    }) {
      return hovered
    }
    return live.first(where: { $0.window?.isKeyWindow == true }) ?? live.first
  }
}
