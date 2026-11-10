import AICore
import AppKit

/// The screenshot's command row (architecture S1), on the shared glass capsule: Ask Atd, a button
/// per command placed on the screenshot toolbar while the row stays within `maxWidth` (a command
/// with options is a split button whose chevron opens them, as on the selection toolbar), More,
/// then after a hairline Copy text. More always shows: it holds the commands that did not fit and,
/// last, the way to customize the toolbar. Command names are user data and stay untranslated;
/// the rest of the copy is read in the current shell language as the row is built.
final class AnnotationCommandRow: NSView {
  typealias Command = SelectionToolbarSettings.Command

  /// What Copy text says: its action, or for a moment what it just did (S4).
  enum CopyState {
    case idle, copied, noText
  }

  var onAsk: (() -> Void)?
  var onRun: ((Command) -> Void)?
  var onOptions: ((ToolbarOptionsChevron, Command) -> Void)?
  var onMore: ((NSButton) -> Void)?
  var onCopyText: (() -> Void)?
  /// The row being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  /// The commands behind More, in order.
  private(set) var overflow: [Command] = []
  private var shown: [Command] = []
  private let copyText: AnnotationToolbarButton
  private let bar: AnnotationGlassBar

  init(commands: [Command], hasOptions: (String) -> Bool, maxWidth: CGFloat) {
    let strings = ShellStrings.shared
    func tip(_ name: String, _ key: String) -> String {
      String(format: strings.text(.captureTooltipShortcut), name, key)
    }
    let ask = AnnotationToolbarButton(
      label: strings.text(.selectionToolbarAsk),
      image: AnnotationIcons.glyph(AnnotationIcons.ask, label: ""), action: #selector(askClicked))
    ask.toolTip = tip(strings.text(.captureCommandsAskTooltip), "/")
    let more = AnnotationToolbarButton(selection: nil, action: #selector(moreClicked))
    let moreName = strings.text(.captureCommandsMoreTooltip)
    more.image = AnnotationIcons.glyph(AnnotationIcons.more, label: moreName)
    more.toolTip = moreName
    more.setAccessibilityLabel(moreName)
    more.setAccessibilityRole(.menuButton)
    let labels = Self.copyLabels()
    copyText = AnnotationToolbarButton(
      label: labels[0], image: AnnotationIcons.glyph(AnnotationIcons.copyText, label: ""),
      width: labels.map { AnnotationToolbarButton.Label.width(text: $0, hasImage: true) }.max(),
      action: #selector(copyTextClicked))
    copyText.toolTip = strings.text(.captureCommandsCopyTextTooltip)
    // The row with Ask, More and Copy text alone; each command adds its part and a gap.
    let padding = AnnotationGlassBar.padding
    var width = padding * 2 + ask.fittingSize.width + 2 + more.fittingSize.width + 13
    width += copyText.fittingSize.width
    var units: [NSView] = []
    var controls: [NSControl] = [ask, more, copyText]
    var shown: [Command] = []
    var overflow: [Command] = []
    for command in commands {
      let unit = Self.unit(for: command, index: units.count, options: hasOptions(command.id))
      let unitWidth = unit.view.fittingSize.width + 2
      guard overflow.isEmpty, width + unitWidth <= maxWidth else {
        overflow.append(command)
        continue
      }
      width += unitWidth
      units.append(unit.view)
      controls += unit.controls
      shown.append(command)
    }
    self.shown = shown
    self.overflow = overflow
    bar = AnnotationGlassBar(groups: [[ask] + units + [more], [copyText]], blending: .withinWindow)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    for control in controls { control.target = self }
    addSubview(bar)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    setAccessibilityLabel(strings.text(.captureCommandsLabel))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// Shows what Copy text just did, or its action again, at its reserved width.
  func showCopy(_ state: CopyState, tooltip: String? = nil) {
    let labels = Self.copyLabels()
    let (label, icon) =
      switch state {
      case .idle: (labels[0], AnnotationIcons.copyText)
      case .copied: (labels[1], AnnotationIcons.confirm)
      case .noText: (labels[2], AnnotationIcons.copyText)
      }
    copyText.setLabel(label, image: AnnotationIcons.glyph(icon, label: ""))
    copyText.presentation =
      switch state {
      case .idle: .standard
      case .copied: .success
      case .noText: .muted
      }
    copyText.toolTip = tooltip ?? ShellStrings.shared.text(.captureCommandsCopyTextTooltip)
  }

  /// Copy text's action and its two confirmations, the first the action.
  private static func copyLabels() -> [String] {
    let strings = ShellStrings.shared
    return [
      strings.text(.captureCommandsCopyText), strings.text(.captureCommandsCopied),
      strings.text(.captureCommandsNoText),
    ]
  }

  /// Command `index`'s place on the row and its controls: its button, or for a command with
  /// options its button and chevron side by side as one split button.
  private static func unit(for command: Command, index: Int, options: Bool)
    -> (view: NSView, controls: [NSControl])
  {
    let strings = ShellStrings.shared
    let button = AnnotationToolbarButton(
      label: command.name, image: nil, action: #selector(AnnotationCommandRow.commandClicked))
    button.tag = index
    button.toolTip = strings.text(.captureCommandsRunTooltip, command.name)
    guard options else { return (button, [button]) }
    let chevron = ToolbarOptionsChevron(action: #selector(AnnotationCommandRow.optionsClicked))
    chevron.tag = index
    let label = strings.text(.commandOptionsMenu, command.name)
    chevron.toolTip = label
    chevron.setAccessibilityLabel(label)
    let split = NSStackView(views: [button, chevron])
    split.spacing = 0
    return (split, [button, chevron])
  }

  @objc private func askClicked() { onAsk?() }
  @objc private func moreClicked(_ sender: NSButton) { onMore?(sender) }
  @objc private func copyTextClicked() { onCopyText?() }

  @objc private func commandClicked(_ sender: NSButton) {
    guard shown.indices.contains(sender.tag) else { return }
    onRun?(shown[sender.tag])
  }

  @objc private func optionsClicked(_ sender: ToolbarOptionsChevron) {
    guard shown.indices.contains(sender.tag) else { return }
    onOptions?(sender, shown[sender.tag])
  }
}

/// The command row turned into a field (architecture S3): a question about the screenshot,
/// sent with Return or the send button at the capsule's end, which ends the session with it;
/// Escape or the close button beside the field goes back to the row. Its own 415 × 40 pt capsule
/// shares the command row's anchor; the slot reserves the wider of the two. An empty submission
/// asks the default question.
final class AnnotationAskBar: NSView, NSTextFieldDelegate {
  var onSubmit: ((String) -> Void)?
  var onClose: (() -> Void)?
  /// The field's capsule being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  private let field = NSTextField(string: "")
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
    bar = AnnotationGlassBar(groups: [[input, close], [send]], blending: .withinWindow)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    field.delegate = self
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
      onClose?()
      return true
    default:
      return false
    }
  }
}
