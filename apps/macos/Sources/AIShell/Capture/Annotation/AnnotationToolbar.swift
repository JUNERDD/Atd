import AICore
import AppKit

/// The annotation toolbar beside the selection: a grip, the tools, undo and redo, the long
/// screenshot where the session offers it, cancel, copy and confirm, on the shared glass capsule
/// (``AnnotationGlassBar``), which the grip or its surface drags. Colours and stroke widths live
/// on the separate ``AnnotationStyleBar``, which appears next to this bar only when there is
/// something to style. Every control has a localized tooltip naming its shortcut, and its glyph a
/// VoiceOver description.
final class AnnotationToolbar: NSView {
  var onTool: ((AnnotationTool) -> Void)?
  var onUndo: (() -> Void)?
  var onRedo: (() -> Void)?
  var onCancel: (() -> Void)?
  var onCopy: (() -> Void)?
  var onConfirm: (() -> Void)?
  var onLongScreenshot: (() -> Void)?
  /// The long screenshot button (decisions D5, D7): hidden while nil, for a session that does not
  /// offer it; otherwise enabled only while `.available`, its tooltip saying why not.
  var longScreenshot: LongScreenshotAvailability? {
    didSet { if longScreenshot != oldValue { applyLongScreenshot() } }
  }
  /// The bar being dragged by its grip or surface.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let grip = AnnotationBarGrip()
  private let tools = AnnotationTool.allCases.map { _ in
    AnnotationToolbarButton(selection: .fill, action: #selector(toolClicked))
  }
  private let undoButton = AnnotationToolbarButton(selection: nil, action: #selector(undoClicked))
  private let redoButton = AnnotationToolbarButton(selection: nil, action: #selector(redoClicked))
  private let longButton = AnnotationToolbarButton(
    selection: nil, action: #selector(longScreenshotClicked))
  private let cancelButton = AnnotationToolbarButton(
    selection: nil, action: #selector(cancelClicked))
  private let copyButton = AnnotationToolbarButton(selection: nil, action: #selector(copyClicked))
  private let confirmButton = AnnotationToolbarButton(
    selection: nil, action: #selector(confirmClicked))
  private let bar: AnnotationGlassBar
  /// The orange dot on the mosaic tool while sensitive text lies unmasked (architecture S6).
  private let mosaicBadge = AnnotationToolBadge()
  private var sensitiveCount = 0

  override init(frame: NSRect) {
    let actions = [undoButton, redoButton, longButton, cancelButton, copyButton, confirmButton]
    bar = AnnotationGlassBar(
      groups: [
        [grip] + (tools as [NSView]), [undoButton, redoButton],
        [longButton, cancelButton, copyButton, confirmButton],
      ], blending: .withinWindow)
    // Hidden, it takes no room: the stack detaches it.
    longButton.isHidden = true
    super.init(frame: frame)
    // Confirm, the bar's primary action, as the ask bar's Send.
    confirmButton.presentation = .primary
    for button in tools + actions { button.target = self }
    if let mosaic = AnnotationTool.allCases.firstIndex(of: .mosaic) {
      mosaicBadge.attach(to: tools[mosaic])
    }
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

  /// Reads the copy in the current shell language (once per session, as it opens).
  func applyStrings() {
    let strings = ShellStrings.shared
    func tip(_ name: String, _ key: String) -> String {
      String(format: strings.text(.captureTooltipShortcut), name, key)
    }
    setAccessibilityLabel(strings.text(.captureToolbar))
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    for (button, tool) in zip(tools, AnnotationTool.allCases) {
      let name = strings.text(Self.key(for: tool))
      button.image = AnnotationIcons.glyph(AnnotationIcons.lucideName(for: tool), label: name)
      var tooltip = tip(name, String(tool.key).uppercased())
      var spoken = name
      if tool == .mosaic, sensitiveCount > 0 {
        let found = strings.text(.captureRedactFound, count: sensitiveCount)
        tooltip += " · " + found
        spoken += ", " + found
      }
      label(button, spoken, tip: tooltip)
    }
    for (button, icon, key, shortcut) in [
      (undoButton, AnnotationIcons.undo, ShellStringKey.captureUndo, "⌘Z"),
      (redoButton, AnnotationIcons.redo, .captureRedo, "⇧⌘Z"),
      (cancelButton, AnnotationIcons.cancel, .cancel, "Esc"),
      (copyButton, AnnotationIcons.copy, .captureCopy, "⌘C"),
      (confirmButton, AnnotationIcons.confirm, .captureConfirm, "↩"),
    ] {
      let name = strings.text(key)
      button.image = AnnotationIcons.glyph(icon, label: name)
      label(button, name, tip: tip(name, shortcut))
    }
    applyLongScreenshot()
  }

  /// The long screenshot button as ``longScreenshot`` has it, in the current shell language.
  private func applyLongScreenshot() {
    longButton.isHidden = longScreenshot == nil
    guard let longScreenshot else { return }
    let strings = ShellStrings.shared
    let name = strings.text(LongScreenshotCaptureStringKey.name)
    let tooltip =
      switch longScreenshot {
      case .available:
        String(
          format: strings.text(.captureTooltipShortcut),
          strings.text(LongScreenshotCaptureStringKey.tooltipAvailable), "⌘↓")
      case .checking: strings.text(LongScreenshotCaptureStringKey.tooltipChecking)
      case .notScrollable: strings.text(LongScreenshotCaptureStringKey.tooltipNotScrollable)
      case .spansDisplays: strings.text(LongScreenshotCaptureStringKey.tooltipSpansDisplays)
      }
    longButton.isEnabled = longScreenshot == .available
    longButton.image = AnnotationIcons.glyph(AnnotationIcons.longScreenshot, label: name)
    label(longButton, name, tip: tooltip)
  }

  /// Leaves the tools, undo and redo, for a host that places the bar itself and offers the
  /// session's actions in its own chrome (the long screenshot's lightbox): the grip, the long
  /// screenshot, cancel, copy and confirm go, the dividers with them.
  func hideSessionControls() {
    grip.isHidden = true
    bar.setGroup(2, hidden: true)
  }

  /// Pins the bar's glass dark (``AnnotationGlassBar/pinDark()``).
  func pinDark() { bar.pinDark() }

  /// How many sensitive items lie unmasked: the mosaic tool carries a dot, and its tooltip and
  /// VoiceOver name the count, while any do.
  func setSensitiveCount(_ count: Int) {
    guard count != sensitiveCount else { return }
    sensitiveCount = count
    mosaicBadge.isHidden = count == 0
    applyStrings()
  }

  /// Shows the current tool (none before the first choice) and undo availability.
  func update(tool: AnnotationTool?, canUndo: Bool, canRedo: Bool) {
    for (button, item) in zip(tools, AnnotationTool.allCases) { button.isSelected = item == tool }
    undoButton.isEnabled = canUndo
    redoButton.isEnabled = canRedo
  }

  private func label(_ button: NSButton, _ name: String, tip: String) {
    button.toolTip = tip
    button.setAccessibilityLabel(name)
  }

  @objc private func toolClicked(_ sender: NSButton) {
    guard let index = tools.firstIndex(where: { $0 === sender }) else { return }
    onTool?(AnnotationTool.allCases[index])
  }

  @objc private func undoClicked() { onUndo?() }
  @objc private func redoClicked() { onRedo?() }
  @objc private func longScreenshotClicked() { onLongScreenshot?() }
  @objc private func cancelClicked() { onCancel?() }
  @objc private func copyClicked() { onCopy?() }
  @objc private func confirmClicked() { onConfirm?() }

  private static func key(for tool: AnnotationTool) -> ShellStringKey {
    switch tool {
    case .select: .captureToolSelect
    case .rectangle: .captureToolRectangle
    case .ellipse: .captureToolEllipse
    case .arrow: .captureToolArrow
    case .line: .captureToolLine
    case .pen: .captureToolPen
    case .highlighter: .captureToolHighlighter
    case .text: .captureToolText
    case .mosaic: .captureToolMosaic
    case .spotlight: .captureToolSpotlight
    case .step: .captureToolStep
    }
  }
}

/// A small orange dot at a tool button's top-right corner: the tool has something to act on.
/// Drawn over the button, never hit.
final class AnnotationToolBadge: NSView {
  static let side: CGFloat = 6

  init() {
    super.init(frame: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
    isHidden = true
    translatesAutoresizingMaskIntoConstraints = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Pins the dot inside `button`'s top-right corner.
  func attach(to button: NSView) {
    button.addSubview(self)
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: Self.side),
      heightAnchor.constraint(equalToConstant: Self.side),
      topAnchor.constraint(equalTo: button.topAnchor, constant: 4),
      trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -4),
    ])
  }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.systemOrange.setFill()
    NSBezierPath(ovalIn: bounds).fill()
  }
}
