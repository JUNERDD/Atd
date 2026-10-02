import AICore
import AppKit

/// The style bar that accompanies the annotation toolbar: colours, stroke widths and, for text,
/// the background toggle, for what there is to style — the open text, the selected annotation,
/// or the next one the active tool draws. The editor shows it only then, and only with the
/// controls that apply (``AnnotationStyleControls``): a mosaic has no colour, so it gets the
/// stroke widths alone (which set how coarse its blocks are). Stroke widths also set text size
/// and step-badge size.
final class AnnotationStyleBar: NSView {
  /// A change the user picked: only the part the control stands for.
  var onChange: ((AnnotationStyleChange) -> Void)?

  /// The bar being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let colors = AnnotationColor.allCases.map { _ in
    AnnotationToolbarButton(selection: .ring, action: #selector(colorClicked))
  }
  private let strokes = AnnotationStroke.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(strokeClicked))
  }
  private let background = AnnotationToolbarButton(
    selection: .toggle, action: #selector(backgroundClicked))
  private let bar: AnnotationGlassBar

  override init(frame: NSRect) {
    bar = AnnotationGlassBar(groups: [colors, strokes, [background]])
    super.init(frame: frame)
    for button in colors + strokes + [background] { button.target = self }
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

  /// The bar's size with every control shown, which the layout reserves so the toolbar keeps
  /// its place whichever controls show.
  var fullSize: NSSize {
    let hidden = [colors[0], strokes[0], background].map(\.isHidden)
    for group in hidden.indices { bar.setGroup(group, hidden: false) }
    defer { for (group, isHidden) in hidden.enumerated() { bar.setGroup(group, hidden: isHidden) } }
    return bar.fittingSize
  }

  /// Reads the copy in the current shell language (once per session, as it opens).
  func applyStrings() {
    let strings = ShellStrings.shared
    setAccessibilityLabel(strings.text(.captureStyleBar))
    for (button, color) in zip(colors, AnnotationColor.allCases) {
      let name = strings.text(Self.key(for: color))
      button.image = AnnotationIcons.swatch(color, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    for (button, stroke) in zip(strokes, AnnotationStroke.allCases) {
      let name = strings.text(Self.key(for: stroke))
      button.image = AnnotationIcons.stroke(stroke, label: name)
      button.toolTip = name
      button.setAccessibilityLabel(name)
    }
    let name = strings.text(.captureTextBackground)
    background.image = AnnotationIcons.glyph(AnnotationIcons.textBackground, label: name)
    background.toolTip = name
    background.setAccessibilityLabel(name)
  }

  /// Shows `style`, with only the `controls` that apply.
  func update(style: AnnotationStyle, controls: AnnotationStyleControls) {
    bar.setGroup(0, hidden: !controls.contains(.colors))
    bar.setGroup(1, hidden: !controls.contains(.strokes))
    bar.setGroup(2, hidden: !controls.contains(.textBackground))
    background.isSelected = style.textBackground
    for (button, item) in zip(colors, AnnotationColor.allCases) {
      button.isSelected = item == style.color
    }
    for (button, item) in zip(strokes, AnnotationStroke.allCases) {
      button.isSelected = item == style.stroke
    }
  }

  @objc private func colorClicked(_ sender: NSButton) {
    guard let index = colors.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(color: AnnotationColor.allCases[index]))
  }

  @objc private func strokeClicked(_ sender: NSButton) {
    guard let index = strokes.firstIndex(where: { $0 === sender }) else { return }
    onChange?(AnnotationStyleChange(stroke: AnnotationStroke.allCases[index]))
  }

  @objc private func backgroundClicked() {
    onChange?(AnnotationStyleChange(textBackground: !background.isSelected))
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

  private static func key(for stroke: AnnotationStroke) -> ShellStringKey {
    switch stroke {
    case .thin: .captureStrokeThin
    case .medium: .captureStrokeMedium
    case .thick: .captureStrokeThick
    }
  }
}
