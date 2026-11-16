import AICore
import AppKit

/// The style bar that accompanies the annotation toolbar, for what there is to style — the open
/// text, the selected annotation, or the next one the active tool draws. The editor shows it only
/// when controls apply (``AnnotationStyleControls``): for mosaic it offers region/brush mode,
/// pixelate/blur/solid redaction, size, and auto-redact; for shapes, arrows, spotlights, steps,
/// and text it offers colour, size, and per-tool options.
final class AnnotationStyleBar: NSView {
  /// What auto-redact can do now: wait for the text, nothing (none found, or all covered), or
  /// cover this many items.
  enum Redaction: Equatable {
    case reading, none, allCovered
    case cover(Int)
  }

  /// A change the user picked: only the part the control stands for, and for a size slider
  /// drag the burst it belongs to (one undo step per drag).
  var onChange: ((AnnotationStyleChange, _ burst: UUID?) -> Void)?
  /// Auto-redact was clicked.
  var onRedact: (() -> Void)?
  var onEyedropper: ((Bool) -> Void)?
  var onOpenColorWheel: ((NSView) -> Void)?
  var onOpenFontPicker: ((NSView) -> Void)?
  var onOpenCornerRadius: ((NSView) -> Void)?
  var onSpotlightDim: ((CGFloat, UUID?) -> Void)?
  var onStepConfig: ((AnnotationStepFormat?, Int?) -> Void)?
  var onScrollSize: ((Double, UUID) -> Bool)?
  var onScrollSpotlightDim: ((Double, UUID) -> Bool)?
  var onSliderBurstEnd: (() -> Void)?
  var colorWheelAnchorView: NSView { extra.colorWheel }
  var fontPickerAnchorView: NSView { extra.fontPicker }
  var cornerButtonAnchorView: NSView { extra.cornerButton }
  var eyedropperActive = false
  var spotlightDimValue: CGFloat = 0.50
  var stepFormatValue: AnnotationStepFormat = .numbers
  var stepStartIndexValue: Int = 1
  var lastCustomColor: AnnotationRGBA?
  /// The bar being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let redactions = AnnotationRedaction.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(redactionClicked))
  }
  let colors = AnnotationColor.allCases.map { _ in
    AnnotationToolbarButton(selection: .ring, action: #selector(colorClicked))
  }
  private let size = AnnotationSizeSlider()
  private let sizeSlot: NSStackView
  private let measures: NSStackView
  private let redact = AnnotationToolbarButton(
    label: "", image: nil, action: #selector(redactClicked))
  let bar: AnnotationGlassBar
  let extra = AnnotationStyleExtraControls()
  struct CachedFormMetrics {
    let mosaicBase: CGFloat
    let otherMax: CGFloat
    let height: CGFloat
  }

  private var redaction = Redaction.reading
  var controls: AnnotationStyleControls = []
  private var appliedControls: AnnotationStyleControls?
  var lastRenderedStyle = AnnotationStyle()
  /// Ends auto-redact's confirmation after a moment.
  private var confirmation: Task<Void, Never>?
  var redactCurrentWidth: CGFloat = 0
  /// How much wider auto-redact's longest label is than the one it shows, which ``fullSize``
  /// reserves.
  private var redactSlack: CGFloat = 0
  var cachedFormMetrics: CachedFormMetrics?
  private var cachedFittingSize: NSSize?
  var wheelCache: (color: AnnotationRGBA?, customActive: Bool, title: String)?
  var lastFontPickerTitle: String?

  override init(frame: NSRect) {
    sizeSlot = NSStackView(views: [size])
    sizeSlot.alignment = .centerY
    sizeSlot.edgeInsets = NSEdgeInsets(top: 0, left: 6, bottom: 0, right: 6)
    sizeSlot.translatesAutoresizingMaskIntoConstraints = false
    sizeSlot.widthAnchor.constraint(equalToConstant: 124).isActive = true
    sizeSlot.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side).isActive = true
    measures = NSStackView(views: [sizeSlot] + extra.measureViews)
    measures.alignment = .centerY
    measures.spacing = 2
    bar = AnnotationGlassBar(
      groups: [
        extra.mosaicModes + redactions,
        colors + [extra.colorWheel, extra.eyedropper],
        [measures],
        [extra.configStack],
        [redact],
      ],
      blending: .withinWindow)
    super.init(frame: frame)
    extra.setTarget(self)
    for button in redactions + colors + [redact] { button.target = self }
    size.target = self
    size.action = #selector(sizeChanged)
    size.onWheelDelta = { [weak self] in self?.onScrollSize?($0, $1) ?? false }
    size.onBurstEnd = { [weak self] in self?.onSliderBurstEnd?() }
    extra.spotlightDimSlider.onWheelDelta = { [weak self] in
      self?.onScrollSpotlightDim?($0, $1) ?? false
    }
    extra.spotlightDimSlider.onBurstEnd = { [weak self] in self?.onSliderBurstEnd?() }
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    applyStrings()
    _ = showControls([])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize {
    if let cachedFittingSize { return cachedFittingSize }
    let measured = bar.fittingSize
    cachedFittingSize = measured
    return measured
  }
  override var intrinsicContentSize: NSSize { fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  func invalidateFontMetrics() {
    cachedFormMetrics = nil
    cachedFittingSize = nil
  }

  /// The bar's size in its widest form across tool modes, reserving horizontal room so the toolbar
  /// keeps its place whichever controls show and whatever auto-redact says.
  var fullSize: NSSize {
    let metrics = cachedFormMetrics ?? measureFormMetrics()
    return NSSize(
      width: max(metrics.mosaicBase + redactCurrentWidth + redactSlack, metrics.otherMax),
      height: metrics.height)
  }

  /// Reads the copy in the current shell language (once per session, as it opens).
  func applyStrings() {
    cachedFormMetrics = nil
    cachedFittingSize = nil
    wheelCache = nil
    lastFontPickerTitle = nil
    let strings = ShellStrings.shared
    setAccessibilityLabel(strings.text(.captureStyleBar))
    for (button, redaction) in zip(redactions, AnnotationRedaction.allCases) {
      let name = strings.text(Self.key(for: redaction))
      button.image = AnnotationIcons.redaction(redaction, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    for (button, color) in zip(colors, AnnotationColor.allCases) {
      let name = strings.text(Self.key(for: color))
      button.image = AnnotationIcons.swatch(color, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    let sizeName = strings.text(.captureSize)
    size.toolTip = strings.text(.captureSizeTooltip)
    size.setAccessibilityLabel(sizeName)
    applyExtraStrings()
    updatePickerControls(style: lastRenderedStyle, controls: controls)
    showRedaction()
  }

  /// Pins the bar's glass dark (``AnnotationGlassBar/pinDark()``).
  func pinDark() { bar.pinDark() }

  /// What auto-redact can do now; a confirmation on show stays until it ends.
  func setRedaction(_ redaction: Redaction) {
    guard redaction != self.redaction else { return }
    self.redaction = redaction
    if confirmation == nil { showRedaction() }
  }

  /// Says in place that `count` items were just covered, with `tooltip`, then what it can do.
  func confirmRedaction(count: Int, tooltip: String) {
    confirmation?.cancel()
    let label = ShellStrings.shared.text(.captureRedactDone, count: count)
    sizeRedact(to: label, image: AnnotationIcons.glyph(AnnotationIcons.redacted, label: ""))
    redact.toolTip = tooltip
    redact.presentation = .success
    redact.isEnabled = false
    confirmation = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1.6))
      guard !Task.isCancelled else { return }
      self?.endRedactionFeedback()
    }
  }

  /// Withdraws auto-redact's confirmation (the selection moved, a tool or undo changed things).
  func endRedactionFeedback() {
    guard let confirmation else { return }
    confirmation.cancel()
    self.confirmation = nil
    showRedaction()
  }

  /// The button for ``redaction``, as wide as what it says (decision D7); the layout reserves its
  /// longest label for counts up to two digits (``fullSize``), so the toolbar stays put.
  private func showRedaction() {
    let strings = ShellStrings.shared
    let label =
      switch redaction {
      case .reading: strings.text(.captureRedactScanning)
      case .none: strings.text(.captureRedactNone)
      case .allCovered: strings.text(.captureRedactAllCovered)
      case .cover(let count): strings.text(.captureRedactAction, count: count)
      }
    sizeRedact(to: label, image: AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: ""))
    redact.toolTip = strings.text(.captureRedactTooltip)
    redact.isEnabled = if case .cover = redaction { true } else { false }
    redact.presentation = .standard
  }

  /// Auto-redact saying `label`, at its width, and the slack to its longest label.
  private func sizeRedact(to label: String, image: NSImage) {
    let strings = ShellStrings.shared
    let width = { (text: String) in AnnotationToolbarButton.Label.width(text: text, hasImage: true)
    }
    let widest =
      [
        strings.text(.captureRedactScanning), strings.text(.captureRedactNone),
        strings.text(.captureRedactAllCovered), strings.text(.captureRedactAction, count: 88),
        strings.text(.captureRedactDone, count: 88),
      ].map(width).max() ?? 0
    let current = width(label)
    let widthChanged = abs(current - redactCurrentWidth) > 0.5
    redactCurrentWidth = current
    redact.setLabel(label, image: image, width: current)
    redactSlack = max(widest - current, 0)
    if widthChanged {
      cachedFittingSize = nil
      invalidateIntrinsicContentSize()
    }
    // The bar grows or shrinks with its label in place (the host is flipped: the top-left stays).
    if superview != nil, widthChanged || frame.size == .zero { setFrameSize(fittingSize) }
  }

  /// Shows `style`, with only the `controls` that apply.
  func update(style: AnnotationStyle, controls: AnnotationStyleControls) {
    self.controls = controls
    self.lastRenderedStyle = style
    if let custom = style.customColor { lastCustomColor = custom }
    let layoutChanged = showControls(controls)
    // The knob being dragged is the user's; the style catches up with it, not the other way.
    if size.burst == nil, abs(size.doubleValue - style.stroke.value) > 1e-9 {
      size.doubleValue = style.stroke.value
    }
    for (button, item) in zip(redactions, AnnotationRedaction.allCases) {
      let selected = item == style.redaction
      if button.isSelected != selected { button.isSelected = selected }
    }
    for (button, item) in zip(colors, AnnotationColor.allCases) {
      let selected = style.customColor == nil && item == style.color
      if button.isSelected != selected { button.isSelected = selected }
    }
    let pickerLayoutChanged = updateExtraState(
      style: style, controls: controls, eyedropperActive: eyedropperActive,
      spotlightDim: spotlightDimValue, stepFormat: stepFormatValue,
      stepStartIndex: stepStartIndexValue)
    resizeToFitIfAttached(layoutChanged: layoutChanged || pickerLayoutChanged)
  }

  /// Updates group and slot visibility for `controls`.
  @discardableResult
  func showControls(_ controls: AnnotationStyleControls) -> Bool {
    guard appliedControls != controls else { return false }
    appliedControls = controls
    cachedFittingSize = nil
    let showMosaicGroup = controls.contains(.redaction) || controls.contains(.mosaicMode)
    bar.setGroup(0, hidden: !showMosaicGroup)
    bar.setGroup(1, hidden: !controls.contains(.colors))
    let measureMask: AnnotationStyleControls = [
      .strokes, .textBackground, .fillMode, .cornerStyle, .arrowStyle, .dashed,
    ]
    bar.setGroup(2, hidden: controls.intersection(measureMask).isEmpty)
    let hideStrokes = !controls.contains(.strokes)
    if sizeSlot.isHidden != hideStrokes { sizeSlot.isHidden = hideStrokes }
    applyExtraVisibility(for: controls)
    return true
  }

  @objc private func redactionClicked(_ sender: NSButton) {
    guard let index = redactions.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(redaction: AnnotationRedaction.allCases[index]), nil)
  }

  @objc private func sizeChanged() {
    let stroke = AnnotationStroke(size.doubleValue)
    guard abs(stroke.value - lastRenderedStyle.stroke.value) > 1e-9 else { return }
    onChange?(AnnotationStyleChange(stroke: stroke), size.burst)
  }

  @objc private func colorClicked(_ sender: NSButton) {
    guard let index = colors.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(color: AnnotationColor.allCases[index]), nil)
  }

  @objc private func redactClicked() { onRedact?() }

  private static func key(for redaction: AnnotationRedaction) -> ShellStringKey {
    switch redaction {
    case .pixelate: .captureRedactionPixelate
    case .blur: .captureRedactionBlur
    case .solid: .captureRedactionSolid
    }
  }

  private static func key(for color: AnnotationColor) -> ShellStringKey {
    switch color {
    case .red: .captureColorRed
    case .yellow: .captureColorYellow
    case .green: .captureColorGreen
    case .blue: .captureColorBlue
    case .black: .captureColorBlack
    case .white: .captureColorWhite
    }
  }
}
