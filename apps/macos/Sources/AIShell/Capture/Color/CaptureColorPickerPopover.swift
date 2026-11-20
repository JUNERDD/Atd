import AICore
import AppKit

/// Compact `264 × 328 pt` color popover with 2D HSB spectrum, `#RRGGBB` editor, RGB/opacity readout,
/// eyedropper trigger, `NSColorPanel.shared` sync, 18-color palette, and 8 recent slots.
@MainActor
final class CaptureColorPickerPopover: NSViewController, NSTextFieldDelegate {
  static let popoverSize = NSSize(width: 264, height: 328)
  private static let curatedHexes: [String] = [
    "#111827", "#EF4444", "#F97316", "#FACC15", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6",
    "#EC4899", "#FFFFFF", "#D1D5DB", "#6B7280", "#FCA5A5", "#FDBA74", "#FDE047", "#86EFAC",
    "#93C5FD", "#D8B4FE",
  ]

  var currentColor: AnnotationRGBA = AnnotationColor.red.rgba {
    didSet { if currentColor != oldValue { syncDisplayedColor() } }
  }
  var recentColors: [AnnotationRGBA] = [] {
    didSet { if recentColors != oldValue { refreshRecentSlots() } }
  }
  /// Continuous drag passes non-nil `burst` (single undo step); discrete actions pass `nil`.
  var onColorChange: ((AnnotationRGBA, UUID?) -> Void)?
  /// Fired when user finishes a drag, submits `#HEX`, or clicks a swatch (for recent colors).
  var onColorCommit: ((AnnotationRGBA) -> Void)?
  var onRequestEyedropper: (() -> Void)?
  var onClose: (() -> Void)?
  var isShown: Bool { panel.isShown }

  let panel = CapturePopoverPanel()
  private let spectrumView = CaptureColorSpectrumView(frame: .zero)
  private let currentChip = CaptureColorSwatchWell(interactive: false)
  private let hexWell = NSView()
  let hexField = ClickToFocusHexTextField()
  private let divider = NSView()
  private lazy var eyedropperButton = CaptureCompactPillButton(
    height: 24, isCapsule: false, cornerRadius: 6, usesAutoLayout: false, explicitWidth: 26,
    labelText: "", maxLabelWidth: 26, action: #selector(eyedropperClicked))
  private lazy var systemButton = CaptureCompactPillButton(
    height: 24, isCapsule: false, cornerRadius: 6, usesAutoLayout: false, explicitWidth: 88,
    labelText: "", maxLabelWidth: 74, action: #selector(systemPanelClicked))
  private let rgbLabel = NSTextField(labelWithString: "")
  private let alphaLabel = NSTextField(labelWithString: "")
  private let paletteHeading = NSTextField(labelWithString: "")
  private let recentHeading = NSTextField(labelWithString: "")
  private var paletteWells: [CaptureColorSwatchWell] = []
  private var recentWells: [CaptureColorSwatchWell] = []
  private var lastHighlightedRGB: (r: Double, g: Double, b: Double)?
  var isSyncingSystemPanel = false
  var isEditingHex = false
  var didCancelHexEdit = false
  var isAttachedToSystemPanel = false
  var savedSystemPanelLevel: NSWindow.Level?
  var savedSystemPanelHidesOnDeactivate: Bool?
  var systemPanelBurst: UUID?

  override init(nibName nibNameOrNil: NSNib.Name?, bundle nibBundleOrNil: Bundle?) {
    super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    preferredContentSize = Self.popoverSize
    panel.onDidClose = { [weak self] in
      self?.spectrumView.finishWheelIfNeeded()
      self?.handlePanelClosed()
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func loadView() {
    let root = CaptureFlippedPopoverView(frame: NSRect(origin: .zero, size: Self.popoverSize))
    root.onAppearanceChange = { [weak self] in self?.refreshLayerColors() }
    view = root
    buildHierarchy(in: root)
    applyStrings()
    syncDisplayedColor()
    refreshRecentSlots()
  }

  func show(
    relativeTo positioningRect: NSRect, of positioningView: NSView,
    preferredEdge: NSRectEdge = .minY
  ) {
    _ = view
    syncDisplayedColor()
    refreshRecentSlots()
    applyStrings()
    panel.show(
      contentView: view, contentSize: Self.popoverSize,
      relativeTo: positioningRect, of: positioningView, preferredEdge: preferredEdge)
    refreshLayerColors()
  }

  func dismissPopover() { panel.dismissPopover() }

  private func buildHierarchy(in root: NSView) {
    let padX: CGFloat = 16
    let contentW: CGFloat = 232
    var y: CGFloat = 10

    spectrumView.frame = NSRect(x: padX, y: y, width: contentW, height: 136)
    spectrumView.onColorChange = { [weak self] rgba, burst in
      self?.applyPickedColor(rgba, burst: burst, commit: false, syncSpectrum: false)
    }
    spectrumView.onColorCommit = { [weak self] rgba in self?.onColorCommit?(rgba) }
    root.addSubview(spectrumView)
    y += 144

    currentChip.frame = NSRect(x: padX, y: y, width: 24, height: 24)
    hexWell.frame = NSRect(x: padX + 30, y: y, width: 78, height: 24)
    hexWell.wantsLayer = true
    hexWell.layer?.cornerRadius = 6
    hexWell.layer?.borderWidth = 0.75
    hexField.frame = NSRect(x: 6, y: 3, width: 66, height: 18)
    hexField.isBordered = false
    hexField.drawsBackground = false
    hexField.focusRingType = .none
    hexField.font = .monospacedSystemFont(ofSize: 11.5, weight: .medium)
    hexField.textColor = .labelColor
    hexField.alignment = .center
    hexField.delegate = self
    hexWell.addSubview(hexField)

    eyedropperButton.frame = NSRect(x: padX + 113, y: y, width: 26, height: 24)
    eyedropperButton.target = self
    systemButton.frame = NSRect(x: padX + 144, y: y, width: 88, height: 24)
    systemButton.target = self
    for child in [currentChip, hexWell, eyedropperButton, systemButton] { root.addSubview(child) }
    y += 28

    setupLabel(rgbLabel, in: root, frame: NSRect(x: padX, y: y, width: 146, height: 14))
    setupLabel(
      alphaLabel, in: root, frame: NSRect(x: padX + 146, y: y, width: 86, height: 14),
      align: .right)
    divider.frame = NSRect(x: padX, y: y + 20, width: contentW, height: 1)
    divider.wantsLayer = true
    root.addSubview(divider)
    y += 27

    setupLabel(
      paletteHeading, in: root, frame: NSRect(x: padX, y: y, width: contentW, height: 13),
      heading: true)
    y += 17

    paletteWells = Self.curatedHexes.enumerated().compactMap { idx, hex in
      guard let rgba = AnnotationRGBA.parseHex(hex) else { return nil }
      let frame = NSRect(
        x: padX + CGFloat(idx % 9) * 26.25, y: y + CGFloat(idx / 9) * 26, width: 22, height: 22)
      return addSwatchWell(frame: frame, color: rgba, tip: hex, to: root)
    }
    y += 55

    setupLabel(
      recentHeading, in: root, frame: NSRect(x: padX, y: y, width: contentW, height: 13),
      heading: true)
    y += 17
    recentWells = (0..<8).map { slot in
      let frame = NSRect(x: padX + CGFloat(slot) * 30, y: y, width: 22, height: 22)
      return addSwatchWell(frame: frame, color: nil, tip: nil, to: root)
    }
    refreshLayerColors()
  }

  private func addSwatchWell(
    frame: NSRect, color: AnnotationRGBA?, tip: String?, to root: NSView
  ) -> CaptureColorSwatchWell {
    let well = CaptureColorSwatchWell(interactive: true)
    well.frame = frame
    well.color = color
    well.toolTip = tip
    well.setAccessibilityLabel(tip)
    well.target = self
    well.action = #selector(swatchClicked(_:))
    root.addSubview(well)
    return well
  }

  private func setupLabel(
    _ field: NSTextField, in root: NSView, frame: NSRect, align: NSTextAlignment = .left,
    heading: Bool = false
  ) {
    field.frame = frame
    field.font =
      heading
      ? .systemFont(ofSize: 10.5, weight: .semibold)
      : .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular)
    field.textColor = .secondaryLabelColor
    field.alignment = align
    field.lineBreakMode = .byTruncatingTail
    root.addSubview(field)
  }

  func refreshLayerColors() {
    guard isViewLoaded else { return }
    view.effectiveAppearance.performAsCurrentDrawingAppearance {
      hexWell.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.055).cgColor
      hexWell.layer?.borderWidth = isEditingHex ? 1.25 : 0.75
      hexWell.layer?.borderColor =
        isEditingHex
        ? NSColor.controlAccentColor.withAlphaComponent(0.85).cgColor
        : NSColor.labelColor.withAlphaComponent(0.16).cgColor
      divider.layer?.backgroundColor = NSColor.separatorColor.withAlphaComponent(0.45).cgColor
    }
  }

  private func applyStrings() {
    let strings = ShellStrings.shared
    paletteHeading.stringValue = strings.text(CaptureToolsStringKey.colorPalette)
    recentHeading.stringValue = strings.text(CaptureToolsStringKey.colorRecent)

    let sysText = strings.text(CaptureToolsStringKey.colorSystem)
    systemButton.labelText = sysText
    systemButton.leadingIcon = AnnotationIcons.glyph(AnnotationIcons.palette, label: sysText)
    systemButton.toolTip = sysText
    systemButton.setAccessibilityLabel(sysText)

    let eyeName = strings.text(CaptureToolsStringKey.eyedropper)
    let eyeTip = String(format: strings.text(.captureTooltipShortcut), eyeName, "I")
    eyedropperButton.leadingIcon = AnnotationIcons.glyph(
      AnnotationIcons.eyedropper, label: eyeName)
    eyedropperButton.toolTip = eyeTip
    eyedropperButton.setAccessibilityLabel(eyeName)

    let hexLabel = strings.text(CaptureToolsStringKey.colorHex)
    hexField.setAccessibilityLabel(hexLabel)
    hexField.toolTip = hexLabel
    updateReadouts()
  }

  private func syncDisplayedColor() {
    guard isViewLoaded else { return }
    spectrumView.setColor(currentColor)
    currentChip.color = currentColor
    let hex = currentColor.hexString
    if !isEditingHex, hexField.stringValue != hex { hexField.stringValue = hex }
    updateReadouts()
    if !isSameHighlightedRGB(currentColor) { updateSelectionHighlights() }
    if isAttachedToSystemPanel, NSColorPanel.sharedColorPanelExists, NSColorPanel.shared.isVisible {
      isSyncingSystemPanel = true
      NSColorPanel.shared.color = currentColor.nsColor
      isSyncingSystemPanel = false
    }
  }

  private func updateReadouts() {
    let r = Int((currentColor.red * 255).rounded())
    let g = Int((currentColor.green * 255).rounded())
    let b = Int((currentColor.blue * 255).rounded())
    let pct = Int((currentColor.alpha * 100).rounded())
    let rgbText = "R \(r)  G \(g)  B \(b)"
    if rgbLabel.stringValue != rgbText { rgbLabel.stringValue = rgbText }
    let alphaText = ShellStrings.shared.text(CaptureToolsStringKey.opacityPercent, count: pct)
    if alphaLabel.stringValue != alphaText { alphaLabel.stringValue = alphaText }
  }

  private func refreshRecentSlots() {
    guard isViewLoaded else { return }
    for (idx, well) in recentWells.enumerated() {
      let color = idx < recentColors.count ? recentColors[idx] : nil
      well.color = color
      well.isEnabled = color != nil
      well.toolTip = color?.hexString
      well.setAccessibilityLabel(color?.hexString)
    }
    updateSelectionHighlights()
  }

  private func updateSelectionHighlights() {
    lastHighlightedRGB = (currentColor.red, currentColor.green, currentColor.blue)
    for well in paletteWells + recentWells {
      well.isChosen = well.color.map { isCloseRGB($0, currentColor) } ?? false
    }
  }

  private func isSameHighlightedRGB(_ color: AnnotationRGBA) -> Bool {
    guard let last = lastHighlightedRGB else { return false }
    return abs(last.r - color.red) < 1e-6 && abs(last.g - color.green) < 1e-6
      && abs(last.b - color.blue) < 1e-6
  }

  private func isCloseRGB(_ a: AnnotationRGBA, _ b: AnnotationRGBA) -> Bool {
    abs(a.red - b.red) < 0.008 && abs(a.green - b.green) < 0.008 && abs(a.blue - b.blue) < 0.008
  }

  func applyPickedColor(
    _ rgba: AnnotationRGBA, burst: UUID?, commit: Bool, syncSpectrum: Bool
  ) {
    currentColor = rgba
    if syncSpectrum { spectrumView.setColor(rgba) }
    onColorChange?(rgba, burst)
    if commit { onColorCommit?(rgba) }
  }
}
