import AICore
import AppKit

/// The long screenshot's control bar beside the selection, on the annotation toolbar's glass
/// capsule (``AnnotationGlassBar``: 6 pt padding, 28 pt controls, a hairline between groups):
/// the grip, the auto-scroll toggle and the screens captured, then back and Done, Done filled
/// as the toolbar's confirm (``AnnotationToolbarButton/Presentation/primary``). The toggle's
/// label and the count each keep the room of the widest thing they may say, so the bar keeps one
/// size while the phase runs; only a change of language resizes it (``applyStrings()``).
///
/// Its surface, grip and count move it (``onDrag``); its owner moves the status row with it.
final class LongScreenshotControlBar: NSView {
  var onAutoScroll: (() -> Void)?
  var onBack: (() -> Void)?
  var onDone: (() -> Void)?
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let grip = AnnotationBarGrip()
  private let autoButton: AnnotationToolbarButton
  private let count = LongScreenshotBarText(style: LongScreenshotBarText.count)
  private let backButton = AnnotationToolbarButton(selection: nil, action: #selector(backClicked))
  private let doneButton = AnnotationToolbarButton(selection: nil, action: #selector(doneClicked))
  private let bar: AnnotationGlassBar
  /// What the toggle and the count show now.
  private var autoScrolling = false
  private var screens = 0.0
  /// The toggle's steady width: its wider label's in the current language, so Back and Done stay
  /// under the pointer while Space flips it during the capture.
  private var toggleWidth: CGFloat = 0
  /// The glyphs of the toggle's two states, made once.
  private let playGlyph: NSImage
  private let pauseGlyph = AnnotationIcons.glyph(LongScreenshotChromeIcons.pause, label: "")

  init() {
    let play = AnnotationIcons.glyph(LongScreenshotChromeIcons.autoScroll, label: "")
    playGlyph = play
    // Its label and width come with the copy (``applyStrings()``).
    autoButton = AnnotationToolbarButton(
      label: "", image: play, width: 0, action: #selector(autoClicked))
    bar = AnnotationGlassBar(
      groups: [[grip, autoButton, count], [backButton, doneButton]], blending: .withinWindow)
    super.init(frame: .zero)
    doneButton.presentation = .primary
    for button in [autoButton, backButton, doneButton] { button.target = self }
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    applyStrings()
    frame.size = bar.fittingSize
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// Reads the copy in the current shell language and reserves the toggle's and the count's
  /// widest values in it.
  func applyStrings() {
    let copy = LongScreenshotChromeCopy.self
    let strings = ShellStrings.shared
    setAccessibilityLabel(copy.text(.bar))
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    let label = AnnotationToolbarButton.Label.self
    // The toggle and the count keep the room of their widest values in this language.
    toggleWidth =
      [copy.text(.autoScroll), copy.text(.pauseScroll)]
      .map { label.width(text: $0, hasImage: true) }.max() ?? 0
    count.width =
      [1.0, copy.widestScreens, screens]
      .map { count.naturalWidth(of: copy.captured($0), glyph: false) }.max() ?? 0
    for (button, icon, name, key) in [
      (backButton, LongScreenshotChromeIcons.back, strings.text(.captureHintBack), "Esc"),
      (doneButton, LongScreenshotChromeIcons.done, strings.text(.captureConfirm), "↩"),
    ] {
      button.image = AnnotationIcons.glyph(icon, label: name)
      button.toolTip = copy.tooltip(name, key: key)
      button.setAccessibilityLabel(name)
    }
    showToggle()
    count.show(copy.captured(screens))
  }

  /// Shows whether Atd is scrolling and how many screens are stitched.
  func show(autoScrolling: Bool, screens: Double) {
    if autoScrolling != self.autoScrolling {
      self.autoScrolling = autoScrolling
      showToggle()
    }
    guard screens != self.screens else { return }
    self.screens = screens
    count.show(LongScreenshotChromeCopy.captured(screens))
  }

  /// The toggle as ``autoScrolling`` has it: Pause while Atd scrolls, Auto-scroll otherwise, at
  /// its steady width (``toggleWidth``).
  private func showToggle() {
    let copy = LongScreenshotChromeCopy.self
    let name = copy.text(autoScrolling ? .pauseScroll : .autoScroll)
    autoButton.setLabel(name, image: autoScrolling ? pauseGlyph : playGlyph, width: toggleWidth)
    autoButton.toolTip = copy.tooltip(name, key: "Space")
  }

  @objc private func autoClicked() { onAutoScroll?() }
  @objc private func backClicked() { onBack?() }
  @objc private func doneClicked() { onDone?() }
}
