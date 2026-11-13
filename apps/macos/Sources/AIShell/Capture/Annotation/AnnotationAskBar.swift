import AICore
import AppKit

/// The command row turned into a field (architecture S3): a question about the screenshot,
/// sent with Return or the send button at the capsule's end, which ends the session with it
/// outside text mode or runs on picked text in text mode; Escape or the close button beside the
/// field goes back to the row (closing any open output menu first). Its 415 × 40 pt capsule
/// (wider in text mode when the "When done" picker shows before Send) shares the command row's
/// anchor; the slot reserves the wider of the two. An empty submission asks the default question.
final class AnnotationAskBar: NSView, NSTextFieldDelegate {
  var onSubmit: ((String) -> Void)?
  var onClose: (() -> Void)?
  var onEscape: (() -> Void)?
  var onOutputMenu: ((NSButton) -> Void)?
  /// The field's capsule being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  /// Widest capsule with the Select Text destination picker showing, reserved by the slot.
  private(set) var reservedSize = NSSize.zero
  var outputControl: NSButton { outputButton }

  private let field = NSTextField(string: "")
  private let outputButton: AnnotationAskOutputButton
  private let send: AnnotationToolbarButton
  private let bar: AnnotationGlassBar

  init() {
    let strings = ShellStrings.shared
    let side = AnnotationToolbarButton.side
    let glyph = AnnotationIcons.glyph(AnnotationIcons.ask, label: "")
    glyph.size = NSSize(width: 14, height: 14)
    let icon = NSImageView(image: glyph)
    icon.contentTintColor = .secondaryLabelColor
    icon.imageScaling = .scaleNone
    icon.translatesAutoresizingMaskIntoConstraints = false
    send = AnnotationToolbarButton(selection: nil, action: #selector(sendClicked))
    send.presentation = .primary
    let sendName = strings.text(.captureCommandsSend)
    send.image = AnnotationIcons.glyph(AnnotationIcons.send, label: sendName)
    send.toolTip = String(format: strings.text(.captureTooltipShortcut), sendName, "↩")
    let close = AnnotationToolbarButton(selection: nil, action: #selector(closeClicked))
    let closeName = strings.text(.captureHintBack)
    close.image = AnnotationIcons.glyph(AnnotationIcons.cancel, label: closeName)
    close.toolTip = String(format: strings.text(.captureTooltipShortcut), closeName, "Esc")
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.font = .systemFont(ofSize: 13)
    field.placeholderString = strings.text(.captureCommandsAskPlaceholder)
    field.setAccessibilityLabel(strings.text(.captureCommandsAskTooltip))
    field.usesSingleLineMode = true
    field.cell?.isScrollable = true
    field.translatesAutoresizingMaskIntoConstraints = false
    let input = NSStackView(views: [icon, field])
    input.orientation = .horizontal
    input.alignment = .centerY
    input.spacing = 6
    input.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 0)
    input.translatesAutoresizingMaskIntoConstraints = false
    // 12 outer padding + 332 field + 2 gap + 28 Close + 13 divider + 28 Send = 415: Send, the
    // primary action, ends the capsule, as Send ends the island's fields.
    // Keep AppKit's editor at its intrinsic height, centred in the 28 pt input allocation.
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 14),
      icon.heightAnchor.constraint(equalToConstant: 14),
      field.widthAnchor.constraint(equalToConstant: 304),
      input.heightAnchor.constraint(equalToConstant: side),
    ])
    outputButton = AnnotationAskOutputButton(action: #selector(outputClicked))
    bar = AnnotationGlassBar(
      groups: [[input, close], [outputButton, send]], blending: .withinWindow)
    let font = AnnotationToolbarButton.Label.font
    let widestOutput =
      CommandOutputChoice.Names(strings.catalog).actions.values.max {
        $0.size(withAttributes: [.font: font]).width
          < $1.size(withAttributes: [.font: font]).width
      } ?? ""
    outputButton.setTitle(widestOutput)
    let maxBarSize = bar.fittingSize
    outputButton.setTitle("")
    bar.setHidden(true, for: outputButton)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    reservedSize = maxBarSize
    field.delegate = self
    outputButton.target = self
    send.target = self
    close.target = self
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    setAccessibilityLabel(strings.text(.captureCommandsAskTooltip))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// Gives the field the keyboard, so what is typed next lands in it: its overlay becomes the key
  /// window too, since `/` may have come through another display's.
  func focus() {
    window?.makeKey()
    window?.makeFirstResponder(field)
  }

  /// ⌘V, ⌘X, ⌘C, ⌘A, ⌘Z and ⇧⌘Z edit the field while it has the keyboard, found by character so
  /// they work on any layout. They are taken here, ahead of the Edit menu, whose Paste and Undo
  /// go to the app's web pages and never reach this field; the canvases leave them to the field,
  /// so ⌘C copies its text rather than the screenshot. While an input method composes, the keys
  /// are its.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown, let editor = field.currentEditor() as? NSTextView,
      window?.firstResponder === editor, !editor.hasMarkedText(),
      let key = event.charactersIgnoringModifiers?.lowercased()
    else { return super.performKeyEquivalent(with: event) }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch (modifiers, key) {
    case (.command, "v"): editor.paste(nil)
    case (.command, "x"): editor.cut(nil)
    case (.command, "c"): editor.copy(nil)
    case (.command, "a"): editor.selectAll(nil)
    case (.command, "z"): editor.undoManager?.undo()
    case ([.command, .shift], "z"): editor.undoManager?.redo()
    default: return super.performKeyEquivalent(with: event)
    }
    return true
  }

  /// Configures whether the Select Text "When done" destination control shows and its label.
  func configure(textMode: Bool, outputLabel: String) {
    outputButton.setTitle(outputLabel)
    let whenDone = ShellStrings.shared.text(.commandOptionsOutput)
    outputButton.toolTip = whenDone
    outputButton.setAccessibilityLabel("\(whenDone), \(outputLabel)")
    bar.setHidden(!textMode, for: outputButton)
    if superview != nil { setFrameSize(fittingSize) }
  }

  func setOutputMenuActive(_ active: Bool) {
    outputButton.isActive = active
  }

  /// Empties the field for the next time it opens.
  func reset() {
    field.stringValue = ""
  }

  private var question: String {
    field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func submit() {
    let question = question
    onSubmit?(question.isEmpty ? ShellStrings.shared.text(.captureCommandsAskDefault) : question)
  }

  @objc private func outputClicked(_ sender: NSButton) { onOutputMenu?(sender) }
  @objc private func sendClicked() { submit() }
  @objc private func closeClicked() { onClose?() }

  // MARK: NSTextFieldDelegate

  /// Return sends (an input method's own Return never reaches here), Escape goes back.
  func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    switch selector {
    case #selector(NSResponder.insertNewline(_:)):
      submit()
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      (onEscape ?? onClose)?()
      return true
    default:
      return false
    }
  }
}

/// Compact destination picker shown before Send in `AnnotationAskBar` while Select Text mode is
/// active: a 28 pt capsule showing the active "When done" label and a trailing down chevron.
private final class AnnotationAskOutputButton: NSButton {
  private static let leadingInset: CGFloat = 10
  private static let chevronGap: CGFloat = 4
  private static let chevronWidth: CGFloat = 9
  private static let trailingInset: CGFloat = 8

  var isHovered = false {
    didSet { if isHovered != oldValue { needsDisplay = true } }
  }

  var isActive = false {
    didSet { if isActive != oldValue { needsDisplay = true } }
  }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  private var labelText = ""
  private var widthConstraint: NSLayoutConstraint!
  private var trackingArea: NSTrackingArea?

  init(action: Selector) {
    let side = AnnotationToolbarButton.side
    super.init(frame: NSRect(x: 0, y: 0, width: side, height: side))
    isBordered = false
    title = ""
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    widthConstraint = widthAnchor.constraint(equalToConstant: side)
    NSLayoutConstraint.activate([widthConstraint, heightAnchor.constraint(equalToConstant: side)])
    setAccessibilityRole(.menuButton)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func setTitle(_ text: String) {
    labelText = text
    let font = AnnotationToolbarButton.Label.font
    let textWidth = min(
      ceil(text.size(withAttributes: [.font: font]).width),
      AnnotationToolbarButton.Label.maxTextWidth)
    widthConstraint.constant =
      Self.leadingInset + textWidth + Self.chevronGap + Self.chevronWidth + Self.trailingInset
    invalidateIntrinsicContentSize()
    needsDisplay = true
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func draw(_ dirtyRect: NSRect) {
    if isEnabled, let wash = isHighlighted || isActive ? 0.16 : (isHovered ? 0.09 : nil) {
      let radius = min(bounds.width, bounds.height) / 2
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
    let color = isEnabled ? NSColor.labelColor : AnnotationToolbarButton.disabledColor
    let font = AnnotationToolbarButton.Label.font
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingTail
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: color, .paragraphStyle: style,
    ]
    let height = ceil(font.ascender - font.descender + font.leading)
    let textWidth = max(
      0, bounds.width - Self.leadingInset - Self.chevronGap - Self.chevronWidth - Self.trailingInset
    )
    let textRect = NSRect(
      x: bounds.minX + Self.leadingInset, y: bounds.midY - height / 2, width: textWidth,
      height: height)
    NSAttributedString(string: labelText, attributes: attributes).draw(in: textRect)
    if let chevron = ToolbarOptionsGlyphs.options {
      let chevronRect = NSRect(
        x: bounds.maxX - Self.trailingInset - Self.chevronWidth, y: bounds.minY,
        width: Self.chevronWidth, height: bounds.height)
      ToolbarOptionsGlyphs.draw(chevron, color: color, centeredIn: chevronRect)
    }
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { isHovered = true }
  override func mouseExited(with event: NSEvent) { isHovered = false }
  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }
}
