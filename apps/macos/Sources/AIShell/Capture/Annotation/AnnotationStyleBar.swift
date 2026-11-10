import AICore
import AppKit

/// The style bar that accompanies the annotation toolbar, for what there is to style — the open
/// text, the selected annotation, or the next one the active tool draws: for a mosaic whether it
/// pixelates, blurs or covers; colours; the size slider; for text the background toggle. The
/// editor shows it only then, and only with the controls that apply
/// (``AnnotationStyleControls``): a mosaic has no colour, and a covering mosaic no size. The size
/// (``AnnotationStroke``) sets each tool's measure: line width, marker width, text size,
/// step-badge size, mosaic block or blur. A mosaic also gets auto-redact (architecture S6): one
/// button that covers every sensitive item the selection's text shows, then says so in place.
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
  /// The bar being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let redactions = AnnotationRedaction.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(redactionClicked))
  }
  private let colors = AnnotationColor.allCases.map { _ in
    AnnotationToolbarButton(selection: .ring, action: #selector(colorClicked))
  }
  private let size = AnnotationSizeSlider()
  private let sizeSlot: NSStackView
  private let measures: NSStackView
  private let background = AnnotationToolbarButton(
    selection: .toggle, action: #selector(backgroundClicked))
  private let redact = AnnotationToolbarButton(
    label: "", image: nil, action: #selector(redactClicked))
  private let bar: AnnotationGlassBar
  private var redaction = Redaction.reading
  private var controls: AnnotationStyleControls = []
  /// Ends auto-redact's confirmation after a moment.
  private var confirmation: Task<Void, Never>?

  override init(frame: NSRect) {
    sizeSlot = NSStackView(views: [size])
    sizeSlot.alignment = .centerY
    sizeSlot.edgeInsets = NSEdgeInsets(top: 0, left: 6, bottom: 0, right: 6)
    sizeSlot.translatesAutoresizingMaskIntoConstraints = false
    sizeSlot.widthAnchor.constraint(equalToConstant: 124).isActive = true
    sizeSlot.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side).isActive = true
    measures = NSStackView(views: [sizeSlot, background])
    measures.alignment = .centerY
    measures.spacing = 2
    bar = AnnotationGlassBar(
      groups: [redactions, colors, [measures], [redact]], blending: .withinWindow)
    super.init(frame: frame)
    for button in redactions + colors + [background, redact] { button.target = self }
    size.target = self
    size.action = #selector(sizeChanged)
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    applyStrings()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// The bar's size in its widest form, a mosaic's (redaction, size, auto-redact) or any other
  /// tool's with every control (colours, size, text background), which the layout reserves so
  /// the toolbar keeps its place whichever controls show.
  var fullSize: NSSize {
    defer { showControls(controls) }
    let forms: [AnnotationStyleControls] = [
      [.redaction, .strokes], [.colors, .strokes, .textBackground],
    ]
    let sizes = forms.map { shown in
      showControls(shown)
      return bar.fittingSize
    }
    return NSSize(
      width: sizes.map(\.width).max() ?? 0, height: sizes.map(\.height).max() ?? 0)
  }

  /// Reads the copy in the current shell language (once per session, as it opens).
  func applyStrings() {
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
    let name = strings.text(.captureTextBackground)
    background.image = AnnotationIcons.glyph(AnnotationIcons.textBackground, label: name)
    background.toolTip = name
    background.setAccessibilityLabel(name)
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
    redact.setLabel(label, image: AnnotationIcons.glyph(AnnotationIcons.redacted, label: ""))
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

  /// The button for ``redaction``, at a width that holds every label it may show for counts up
  /// to two digits, so the bar keeps its width.
  private func showRedaction() {
    let strings = ShellStrings.shared
    let label =
      switch redaction {
      case .reading: strings.text(.captureRedactScanning)
      case .none: strings.text(.captureRedactNone)
      case .allCovered: strings.text(.captureRedactAllCovered)
      case .cover(let count): strings.text(.captureRedactAction, count: count)
      }
    let widest = [
      strings.text(.captureRedactScanning), strings.text(.captureRedactNone),
      strings.text(.captureRedactAllCovered), strings.text(.captureRedactAction, count: 88),
      strings.text(.captureRedactDone, count: 88),
    ].map { AnnotationToolbarButton.Label.width(text: $0, hasImage: true) }.max()
    redact.setLabel(
      label, image: AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: ""), width: widest)
    redact.toolTip = strings.text(.captureRedactTooltip)
    redact.isEnabled = if case .cover = redaction { true } else { false }
    redact.presentation = .standard
  }

  /// Shows `style`, with only the `controls` that apply.
  func update(style: AnnotationStyle, controls: AnnotationStyleControls) {
    self.controls = controls
    showControls(controls)
    background.isSelected = style.textBackground
    // The knob being dragged is the user's; the style catches up with it, not the other way.
    if size.burst == nil { size.doubleValue = style.stroke.value }
    for (button, item) in zip(redactions, AnnotationRedaction.allCases) {
      button.isSelected = item == style.redaction
    }
    for (button, item) in zip(colors, AnnotationColor.allCases) {
      button.isSelected = item == style.color
    }
  }

  /// The slider and text background share a group; either can disappear without a divider
  /// between them. The native slider keeps its 112 pt artwork inside a 124 × 28 pt allocation.
  private func showControls(_ controls: AnnotationStyleControls) {
    bar.setGroup(0, hidden: !controls.contains(.redaction))
    bar.setGroup(1, hidden: !controls.contains(.colors))
    bar.setGroup(2, hidden: controls.intersection([.strokes, .textBackground]).isEmpty)
    bar.setGroup(3, hidden: !controls.contains(.redaction))
    sizeSlot.isHidden = !controls.contains(.strokes)
    background.isHidden = !controls.contains(.textBackground)
  }

  @objc private func redactionClicked(_ sender: NSButton) {
    guard let index = redactions.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(redaction: AnnotationRedaction.allCases[index]), nil)
  }

  @objc private func sizeChanged() {
    onChange?(AnnotationStyleChange(stroke: AnnotationStroke(size.doubleValue)), size.burst)
  }

  @objc private func colorClicked(_ sender: NSButton) {
    guard let index = colors.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(color: AnnotationColor.allCases[index]), nil)
  }

  @objc private func backgroundClicked() {
    onChange?(AnnotationStyleChange(textBackground: !background.isSelected), nil)
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
