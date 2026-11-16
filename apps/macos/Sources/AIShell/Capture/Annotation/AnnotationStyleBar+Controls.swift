import AICore
import AppKit

/// Owns the per-tool option buttons, sliders, and picker triggers inside ``AnnotationStyleBar``
/// while preserving `28 pt` glass capsule metrics.
final class AnnotationStyleExtraControls {
  let mosaicModes: [AnnotationToolbarButton]
  let colorWheel: AnnotationToolbarButton
  let eyedropper: AnnotationToolbarButton
  let fillButtons: [AnnotationToolbarButton]
  let cornerButton: AnnotationToolbarButton
  let arrowButtons: [AnnotationToolbarButton]
  let dashedButton: AnnotationToolbarButton
  let textPlates: [AnnotationToolbarButton]
  let spotlightShapeButton: AnnotationToolbarButton
  let spotlightDimSlider = AnnotationSizeSlider()
  let spotlightDimSlot: NSStackView
  let stepFormatButton: AnnotationToolbarButton
  let stepMinusButton: AnnotationToolbarButton
  let stepStartLabel = NSTextField(labelWithString: "1")
  let stepPlusButton: AnnotationToolbarButton
  let fontPicker: CaptureCompactPillButton
  let configStack: NSStackView

  init() {
    mosaicModes = AnnotationMosaicMode.allCases.map { _ in
      AnnotationToolbarButton(
        selection: .fill, action: #selector(AnnotationStyleBar.mosaicModeClicked(_:)))
    }
    colorWheel = AnnotationToolbarButton(
      selection: .ring, action: #selector(AnnotationStyleBar.colorWheelClicked))
    eyedropper = AnnotationToolbarButton(
      selection: .toggle, action: #selector(AnnotationStyleBar.eyedropperClicked))
    fillButtons = AnnotationFillMode.allCases.map { _ in
      AnnotationToolbarButton(
        selection: .fill, action: #selector(AnnotationStyleBar.fillClicked(_:)))
    }
    cornerButton = AnnotationToolbarButton(
      selection: .toggle, action: #selector(AnnotationStyleBar.cornerClicked))
    arrowButtons = AnnotationArrowStyle.allCases.map { _ in
      AnnotationToolbarButton(
        selection: .fill, action: #selector(AnnotationStyleBar.arrowStyleClicked(_:)))
    }
    dashedButton = AnnotationToolbarButton(
      selection: .toggle, action: #selector(AnnotationStyleBar.dashedClicked))
    textPlates = AnnotationTextPlate.allCases.map { _ in
      AnnotationToolbarButton(
        selection: .fill, action: #selector(AnnotationStyleBar.textPlateClicked(_:)))
    }
    spotlightShapeButton = AnnotationToolbarButton(
      selection: .toggle, action: #selector(AnnotationStyleBar.spotlightShapeClicked))
    stepFormatButton = AnnotationToolbarButton(
      selection: .toggle, action: #selector(AnnotationStyleBar.stepFormatClicked))
    stepMinusButton = AnnotationToolbarButton(
      selection: nil, action: #selector(AnnotationStyleBar.stepStartMinusClicked))
    stepPlusButton = AnnotationToolbarButton(
      selection: nil, action: #selector(AnnotationStyleBar.stepStartPlusClicked))

    spotlightDimSlot = NSStackView(views: [spotlightDimSlider])
    spotlightDimSlot.alignment = .centerY
    spotlightDimSlot.edgeInsets = NSEdgeInsets(top: 0, left: 6, bottom: 0, right: 6)
    spotlightDimSlot.translatesAutoresizingMaskIntoConstraints = false
    spotlightDimSlot.widthAnchor.constraint(equalToConstant: 112).isActive = true
    spotlightDimSlot.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side)
      .isActive = true
    spotlightDimSlider.action = #selector(AnnotationStyleBar.spotlightDimChanged)

    stepStartLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
    stepStartLabel.textColor = .labelColor
    stepStartLabel.alignment = .center
    stepStartLabel.translatesAutoresizingMaskIntoConstraints = false
    stepStartLabel.widthAnchor.constraint(equalToConstant: 22).isActive = true

    fontPicker = CaptureCompactPillButton(
      height: AnnotationToolbarButton.side, isCapsule: true, leadingBadge: "Aa",
      labelText: "", maxLabelWidth: 92, action: #selector(AnnotationStyleBar.fontPickerClicked))
    configStack = NSStackView(views: [
      spotlightShapeButton, spotlightDimSlot,
      stepFormatButton, stepMinusButton, stepStartLabel, stepPlusButton,
      fontPicker,
    ])
    configStack.alignment = .centerY
    configStack.spacing = 2
  }

  func setTarget(_ target: AnyObject) {
    spotlightDimSlider.target = target
    fontPicker.target = target
    let groups: [[AnnotationToolbarButton]] = [
      mosaicModes, [colorWheel, eyedropper],
      fillButtons, [cornerButton],
      arrowButtons, [dashedButton],
      textPlates,
      [spotlightShapeButton, stepFormatButton, stepMinusButton, stepPlusButton],
    ]
    for group in groups {
      for button in group { button.target = target }
    }
  }

  var measureViews: [NSView] {
    textPlates + fillButtons + [cornerButton] + arrowButtons + [dashedButton]
  }
}

extension AnnotationStyleBar {
  func applyExtraStrings() {
    let strings = ShellStrings.shared
    let mosaicSpecs: [(String, CaptureToolsStringKey)] = [
      (AnnotationIcons.mosaicRegion, .mosaicRegion),
      (AnnotationIcons.mosaicBrush, .mosaicBrush),
    ]
    for (btn, spec) in zip(extra.mosaicModes, mosaicSpecs) {
      let label = strings.text(spec.1)
      btn.image = AnnotationIcons.glyph(spec.0, label: label)
      btn.toolTip = label
      btn.setAccessibilityLabel(label)
    }

    let eyeLabel = strings.text(CaptureToolsStringKey.eyedropper)
    extra.eyedropper.image = AnnotationIcons.glyph(AnnotationIcons.eyedropper, label: eyeLabel)
    extra.eyedropper.toolTip = String(
      format: strings.text(.captureTooltipShortcut), eyeLabel, "I")
    extra.eyedropper.setAccessibilityLabel(eyeLabel)

    let fillSpecs: [(String, CaptureToolsStringKey)] = [
      (AnnotationIcons.fillOutline, .fillOutline),
      (AnnotationIcons.fillSoft, .fillSoft),
      (AnnotationIcons.fillSolid, .fillSolid),
    ]
    for (btn, spec) in zip(extra.fillButtons, fillSpecs) {
      let label = strings.text(spec.1)
      btn.image = AnnotationIcons.glyph(spec.0, label: label)
      btn.toolTip = label
      btn.setAccessibilityLabel(label)
    }

    let cornerLabel = strings.text(CaptureToolsStringKey.cornerRadius)
    extra.cornerButton.image = AnnotationIcons.glyph(
      AnnotationIcons.cornerRounded, label: cornerLabel)
    extra.cornerButton.toolTip = nil
    extra.cornerButton.setAccessibilityLabel(cornerLabel)

    let arrowSpecs: [(String, CaptureToolsStringKey)] = [
      (AnnotationIcons.arrowTapered, .arrowTapered),
      (AnnotationIcons.arrowClassic, .arrowClassic),
      (AnnotationIcons.arrowDouble, .arrowDouble),
    ]
    for (btn, spec) in zip(extra.arrowButtons, arrowSpecs) {
      let label = strings.text(spec.1)
      btn.image = AnnotationIcons.glyph(spec.0, label: label)
      btn.toolTip = label
      btn.setAccessibilityLabel(label)
    }

    let dashLabel = strings.text(CaptureToolsStringKey.strokeDashed)
    extra.dashedButton.image = AnnotationIcons.glyph(AnnotationIcons.dashed, label: dashLabel)
    extra.dashedButton.toolTip = dashLabel
    extra.dashedButton.setAccessibilityLabel(dashLabel)

    let plateSpecs: [(String, CaptureToolsStringKey)] = [
      ("type", .textPlateNone),
      (AnnotationIcons.textBackground, .textPlateSolid),
      ("layers", .textPlateFrosted),
      ("a-large-small", .textPlateOutlined),
    ]
    for (btn, spec) in zip(extra.textPlates, plateSpecs) {
      let label = strings.text(spec.1)
      btn.image = AnnotationIcons.glyph(spec.0, label: label)
      btn.toolTip = label
      btn.setAccessibilityLabel(label)
    }

    let spotShapeLabel = strings.text(CaptureToolsStringKey.spotlightShape)
    extra.spotlightShapeButton.image = AnnotationIcons.glyph(
      AnnotationIcons.spotlightEllipse, label: spotShapeLabel)
    extra.spotlightShapeButton.toolTip = spotShapeLabel
    extra.spotlightShapeButton.setAccessibilityLabel(spotShapeLabel)

    let dimLabel = strings.text(CaptureToolsStringKey.spotlightDim)
    extra.spotlightDimSlider.toolTip = dimLabel
    extra.spotlightDimSlider.setAccessibilityLabel(dimLabel)

    let stepLabel = strings.text(CaptureToolsStringKey.stepFormat)
    extra.stepFormatButton.image = AnnotationIcons.glyph(
      AnnotationIcons.stepLetters, label: stepLabel)
    extra.stepFormatButton.toolTip = stepLabel
    extra.stepFormatButton.setAccessibilityLabel(stepLabel)

    let minusLabel = strings.text(CaptureToolsStringKey.stepStartDecrease)
    extra.stepMinusButton.image = AnnotationIcons.glyph(AnnotationIcons.minus, label: minusLabel)
    extra.stepMinusButton.toolTip = minusLabel
    extra.stepMinusButton.setAccessibilityLabel(minusLabel)

    let plusLabel = strings.text(CaptureToolsStringKey.stepStartIncrease)
    extra.stepPlusButton.image = AnnotationIcons.glyph(AnnotationIcons.plus, label: plusLabel)
    extra.stepPlusButton.toolTip = plusLabel
    extra.stepPlusButton.setAccessibilityLabel(plusLabel)

    let pickerTitle = strings.text(CaptureToolsStringKey.fontPicker)
    extra.fontPicker.trailingIcon = AnnotationIcons.glyph(
      AnnotationIcons.chevronDown, label: pickerTitle)
  }

  func applyExtraVisibility(for controls: AnnotationStyleControls) {
    func setHidden(_ view: NSView, _ hidden: Bool) {
      if view.isHidden != hidden { view.isHidden = hidden }
    }
    let hideMosaic = !controls.contains(.mosaicMode)
    for btn in extra.mosaicModes { setHidden(btn, hideMosaic) }
    setHidden(extra.eyedropper, !controls.contains(.colors))
    let hidePlate = !controls.contains(.textBackground)
    for btn in extra.textPlates { setHidden(btn, hidePlate) }
    let hideFill = !controls.contains(.fillMode)
    for btn in extra.fillButtons { setHidden(btn, hideFill) }
    setHidden(extra.cornerButton, !controls.contains(.cornerStyle))
    let hideArrow = !controls.contains(.arrowStyle)
    for btn in extra.arrowButtons { setHidden(btn, hideArrow) }
    setHidden(extra.dashedButton, !controls.contains(.dashed))
    setHidden(extra.spotlightShapeButton, !controls.contains(.spotlightShape))
    setHidden(extra.spotlightDimSlot, !controls.contains(.spotlightDim))
    let hideStep = !controls.contains(.stepConfig)
    setHidden(extra.stepFormatButton, hideStep)
    setHidden(extra.stepMinusButton, hideStep)
    setHidden(extra.stepStartLabel, hideStep)
    setHidden(extra.stepPlusButton, hideStep)
    applyPickerVisibility(for: controls)
    bar.setGroup(4, hidden: !controls.contains(.redaction))
  }

  func updateExtraState(
    style: AnnotationStyle,
    controls: AnnotationStyleControls,
    eyedropperActive: Bool,
    spotlightDim: CGFloat,
    stepFormat: AnnotationStepFormat,
    stepStartIndex: Int
  ) -> Bool {
    func setSelected(_ button: AnnotationToolbarButton, _ selected: Bool) {
      if button.isSelected != selected { button.isSelected = selected }
    }
    for (btn, mode) in zip(extra.mosaicModes, AnnotationMosaicMode.allCases) {
      setSelected(btn, mode == style.mosaicMode)
    }
    setSelected(extra.eyedropper, eyedropperActive)
    for (btn, plate) in zip(extra.textPlates, AnnotationTextPlate.allCases) {
      setSelected(btn, plate == style.textPlate)
    }
    for (btn, fill) in zip(extra.fillButtons, AnnotationFillMode.allCases) {
      setSelected(btn, fill == style.fillMode)
    }
    setSelected(
      extra.cornerButton, style.cornerStyle == .rounded && style.displayCornerRadius > 0)
    for (btn, arrow) in zip(extra.arrowButtons, AnnotationArrowStyle.allCases) {
      setSelected(btn, arrow == style.arrowStyle)
    }
    setSelected(extra.dashedButton, style.isDashed)
    setSelected(extra.spotlightShapeButton, style.spotlightShape == .ellipse)
    let targetDim = Double((spotlightDim - 0.25) / 0.60)
    if extra.spotlightDimSlider.burst == nil,
      abs(extra.spotlightDimSlider.doubleValue - targetDim) > 1e-9
    {
      extra.spotlightDimSlider.doubleValue = targetDim
    }
    setSelected(extra.stepFormatButton, stepFormat == .letters)
    let stepText = stepFormat.format(index: stepStartIndex)
    if extra.stepStartLabel.stringValue != stepText {
      extra.stepStartLabel.stringValue = stepText
    }
    return updatePickerControls(style: style, controls: controls)
  }

  @objc func mosaicModeClicked(_ sender: NSButton) {
    guard let idx = extra.mosaicModes.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(mosaicMode: AnnotationMosaicMode.allCases[idx]), nil)
  }

  @objc func eyedropperClicked() {
    onEyedropper?(!extra.eyedropper.isSelected)
  }

  @objc func fillClicked(_ sender: NSButton) {
    guard let idx = extra.fillButtons.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(fillMode: AnnotationFillMode.allCases[idx]), nil)
  }

  @objc func cornerClicked() {
    onOpenCornerRadius?(cornerButtonAnchorView)
  }

  @objc func arrowStyleClicked(_ sender: NSButton) {
    guard let idx = extra.arrowButtons.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(arrowStyle: AnnotationArrowStyle.allCases[idx]), nil)
  }

  @objc func dashedClicked() {
    onChange?(AnnotationStyleChange(isDashed: !extra.dashedButton.isSelected), nil)
  }

  @objc func textPlateClicked(_ sender: NSButton) {
    guard let idx = extra.textPlates.firstIndex(where: { $0 === sender }) else { return }
    let plate = AnnotationTextPlate.allCases[idx]
    onChange?(AnnotationStyleChange(textBackground: plate != .none, textPlate: plate), nil)
  }

  @objc func spotlightShapeClicked() {
    let next: AnnotationSpotlightShape = extra.spotlightShapeButton.isSelected ? .sharp : .ellipse
    onChange?(AnnotationStyleChange(spotlightShape: next), nil)
  }

  @objc func spotlightDimChanged() {
    let dim = 0.25 + CGFloat(extra.spotlightDimSlider.doubleValue) * 0.60
    guard abs(dim - spotlightDimValue) > 1e-9 else { return }
    spotlightDimValue = dim
    onSpotlightDim?(dim, extra.spotlightDimSlider.burst)
  }

  @objc func stepFormatClicked() {
    let next: AnnotationStepFormat = extra.stepFormatButton.isSelected ? .numbers : .letters
    onStepConfig?(next, nil)
  }

  @objc func stepStartMinusClicked() { onStepConfig?(nil, -1) }
  @objc func stepStartPlusClicked() { onStepConfig?(nil, 1) }
}
