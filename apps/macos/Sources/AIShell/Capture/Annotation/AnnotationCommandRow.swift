import AICore
import AppKit

/// One of the screenshot's command rows (architecture S1), on the shared glass capsule; the slot
/// shows one at a time (``AnnotationCommandSlot``).
///
/// - The screenshot row: Ask Atd, a button per command placed on the screenshot toolbar while the
///   row stays within `maxWidth` (a command with options is a split button whose chevron opens
///   them, as on the selection toolbar), More, then after a hairline Copy text and Select Text
///   (text mode's way in), and after another the shortcut to auto-redact, shown only while it
///   has something to cover or says it just did (decision D7).
/// - The text row, while text mode is on: the scope chip (what a command reads, with × to clear
///   the picks), Ask Atd, the commands placed on `screenshotText` the same way, More, then after
///   a hairline Copy.
///
/// More always shows: it holds the commands that did not fit and, last, the way to customize the
/// toolbar. A running text command's bar sits under its button (or More's) without changing a
/// label, so the row keeps its width while a command runs. A label that changes (Copy's
/// confirmation, the shortcut's, the scope chip's count) sizes its part to what it says and the
/// row grows or shrinks in place; ``reservedSize`` is the row with every part showing at its
/// longest, which the toolbar's placement keeps room for so nothing moves.
/// Command names are user data and stay untranslated; the rest of the copy is read in the current
/// shell language as the row is built.
final class AnnotationCommandRow: NSView {
  typealias Command = SelectionToolbarSettings.Command

  enum Kind {
    case screenshot, text
  }

  /// What Copy text (or the text row's Copy) says: its action, or for a moment what it just did.
  enum CopyState {
    case idle, copied, noText
  }

  /// The screenshot row's auto-redact shortcut: hidden, covering this many items, or saying for
  /// a moment that it covered them.
  enum Redaction: Equatable {
    case hidden
    case cover(Int)
    case done(Int)
  }

  var onAsk: (() -> Void)?
  var onRun: ((Command) -> Void)?
  var onOptions: ((ToolbarOptionsChevron, Command) -> Void)?
  var onMore: ((NSButton) -> Void)?
  var onCopy: (() -> Void)?
  var onSelectText: (() -> Void)?
  var onRedact: (() -> Void)?
  /// The scope chip's ×.
  var onScopeClear: (() -> Void)? {
    get { scope?.onClear }
    set { scope?.onClear = newValue }
  }
  /// The row being dragged by its surface; it moves with the toolbar.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }

  let kind: Kind
  /// The commands behind More, in order.
  private(set) var overflow: [Command] = []
  private var shown: [Command] = []
  /// Each shown command's button, by command id.
  private var buttons: [String: NSButton] = [:]
  private let more: AnnotationToolbarButton
  private let copy: AnnotationToolbarButton
  private let selectText: AnnotationToolbarButton?
  private let redact: AnnotationToolbarButton?
  private let scope: AnnotationScopeChip?
  private let runBar = AnnotationRunBar()
  /// The button the running bar sits under.
  private weak var running: NSView?
  private let bar: AnnotationGlassBar
  /// The row with every part showing, each at its widest.
  private(set) var reservedSize = NSSize.zero

  init(kind: Kind, commands: [Command], hasOptions: (String) -> Bool, maxWidth: CGFloat) {
    self.kind = kind
    let strings = ShellStrings.shared
    let ask = AnnotationToolbarButton(
      label: strings.text(.selectionToolbarAsk),
      image: AnnotationIcons.glyph(AnnotationIcons.ask, label: ""), action: #selector(askClicked))
    ask.toolTip = String(
      format: strings.text(.captureTooltipShortcut), strings.text(.captureCommandsAskTooltip), "/")
    more = AnnotationToolbarButton(selection: nil, action: #selector(moreClicked))
    let moreName = strings.text(.captureCommandsMoreTooltip)
    more.image = AnnotationIcons.glyph(AnnotationIcons.more, label: moreName)
    more.toolTip = moreName
    more.setAccessibilityLabel(moreName)
    more.setAccessibilityRole(.menuButton)
    copy = AnnotationToolbarButton(
      label: Self.copyLabels(kind)[0],
      image: kind == .screenshot ? AnnotationIcons.glyph(AnnotationIcons.copyText, label: "") : nil,
      action: #selector(copyClicked))
    copy.toolTip = Self.copyTooltip(kind)
    var fixed: [NSView] = [ask, more, copy]
    var groups: [[NSView]]
    switch kind {
    case .screenshot:
      let select = AnnotationToolbarButton(
        label: strings.text(CaptureTextModeStringKey.selectText),
        image: AnnotationIcons.glyph(AnnotationIcons.selectText, label: ""),
        action: #selector(selectTextClicked))
      select.toolTip = strings.text(CaptureTextModeStringKey.selectTextTooltip)
      let redact = AnnotationToolbarButton(
        label: strings.text(CaptureTextModeStringKey.redact),
        image: AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: ""),
        action: #selector(redactClicked))
      selectText = select
      self.redact = redact
      scope = nil
      fixed += [select, redact]
      groups = [[ask, more], [copy, select], [redact]]
    case .text:
      let chip = AnnotationScopeChip()
      selectText = nil
      redact = nil
      scope = chip
      fixed.append(chip)
      groups = [[chip], [ask, more], [copy]]
    }
    // The row with its fixed parts alone: 2 pt between neighbours of a group, 13 pt for each
    // hairline with its gaps. Each command adds its part and a gap while it fits.
    let padding = AnnotationGlassBar.padding
    var width = padding * 2 + fixed.map(\.fittingSize.width).reduce(0, +)
    width += groups.map { CGFloat(max($0.count - 1, 0)) * 2 }.reduce(0, +)
    width += CGFloat(groups.count - 1) * 13
    var units: [NSView] = []
    var controls: [NSControl] = [ask, more, copy] + [selectText, redact].compactMap(\.self)
    for command in commands {
      let unit = Self.unit(for: command, index: units.count, options: hasOptions(command.id), kind)
      let unitWidth = unit.view.fittingSize.width + 2
      guard overflow.isEmpty, width + unitWidth <= maxWidth else {
        overflow.append(command)
        continue
      }
      width += unitWidth
      units.append(unit.view)
      controls += unit.controls
      shown.append(command)
      buttons[command.id] = unit.controls.first as? NSButton
    }
    let commandGroup = kind == .screenshot ? 0 : 1
    groups[commandGroup] = [ask] + units + [more]
    bar = AnnotationGlassBar(groups: groups, blending: .withinWindow)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    reservedSize = widestSize()
    for control in controls { control.target = self }
    addSubview(bar)
    runBar.isHidden = true
    addSubview(runBar)
    if kind == .screenshot { setRedaction(.hidden) }
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    setAccessibilityLabel(
      kind == .screenshot
        ? strings.text(.captureCommandsLabel) : strings.text(CaptureTextModeStringKey.label))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
    placeRunBar()
  }

  // MARK: States

  /// Shows what Copy text or Copy just did, or its action again, at its reserved width.
  func showCopy(_ state: CopyState, tooltip: String? = nil) {
    let labels = Self.copyLabels(kind)
    let (label, icon): (String, String?) =
      switch state {
      case .idle: (labels[0], AnnotationIcons.copyText)
      case .copied: (labels[1], AnnotationIcons.confirm)
      case .noText: (labels[2], AnnotationIcons.copyText)
      }
    let image = kind == .screenshot ? icon.map { AnnotationIcons.glyph($0, label: "") } : nil
    copy.setLabel(label, image: image)
    copy.presentation =
      switch state {
      case .idle: .standard
      case .copied: .success
      case .noText: .muted
      }
    copy.toolTip = tooltip ?? Self.copyTooltip(kind)
    fit()
  }

  /// Select Text: enabled unless the selection was read and holds no text (`false`).
  func setSelectText(hasText: Bool?) {
    guard let selectText else { return }
    let none = hasText == false
    selectText.isEnabled = !none
    let strings = ShellStrings.shared
    selectText.toolTip = strings.text(
      none ? CaptureTextModeStringKey.selectTextNone : .selectTextTooltip)
  }

  /// The auto-redact shortcut's state; its group shows only while it covers or confirms.
  func setRedaction(_ state: Redaction) {
    guard let redact else { return }
    let strings = ShellStrings.shared
    switch state {
    case .hidden:
      break
    case .cover(let count):
      redact.setLabel(
        strings.text(CaptureTextModeStringKey.redact),
        image: AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: ""))
      redact.toolTip = strings.text(CaptureTextModeStringKey.redactTooltip, count: count)
      redact.presentation = .standard
      redact.isEnabled = true
    case .done(let count):
      redact.setLabel(
        strings.text(.captureRedactDone, count: count),
        image: AnnotationIcons.glyph(AnnotationIcons.redacted, label: ""))
      redact.presentation = .success
      redact.isEnabled = false
    }
    bar.setGroup(2, hidden: state == .hidden)
    fit()
  }

  /// The confirmation's tooltip (what was covered and how to undo it).
  func setRedactionTooltip(_ tooltip: String) { redact?.toolTip = tooltip }

  /// The scope chip's words.
  func setScope(_ label: String) {
    scope?.setLabel(label)
    fit()
  }

  /// The row at the size of what it shows now, in place: its host is flipped, so the top-left
  /// stays where the toolbar put it.
  private func fit() {
    guard superview != nil else { return }
    setFrameSize(fittingSize)
  }

  /// The row with every part showing and each label that changes at its longest form (Copy's,
  /// the shortcut's at a two-digit count, the scope chip's), measured once with the current
  /// language's copy; the parts then show their idle labels again.
  private func widestSize() -> NSSize {
    let strings = ShellStrings.shared
    let copyImage =
      kind == .screenshot ? AnnotationIcons.glyph(AnnotationIcons.copyText, label: "") : nil
    let width = { (text: String) in
      AnnotationToolbarButton.Label.width(text: text, hasImage: copyImage != nil)
    }
    copy.setLabel(Self.copyLabels(kind).max { width($0) < width($1) } ?? "", image: copyImage)
    let redactImage = AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: "")
    redact?.setLabel(strings.text(.captureRedactDone, count: 88), image: redactImage)
    scope?.setLabel(AnnotationScopeChip.widestLabel)
    let size = bar.fittingSize
    showCopy(.idle)
    redact?.setLabel(strings.text(CaptureTextModeStringKey.redact), image: redactImage)
    scope?.setLabel("")
    return size
  }

  /// The running bar under command `id`'s button, or under More when it sits there; nil hides it.
  func setRunning(_ id: String?) {
    let next: NSView? = id.map { buttons[$0] ?? more }
    guard next !== running else { return }
    running = next
    if running == nil {
      runBar.stop()
    } else {
      placeRunBar()
      runBar.start()
    }
  }

  /// 2 pt under the label, 9 pt in from the button's ends, 3 pt above its bottom edge.
  private func placeRunBar() {
    guard let running, running.superview != nil else { return }
    let rect = convert(running.bounds, from: running)
    let y = isFlipped ? rect.maxY - 3 - 2 : rect.minY + 3
    runBar.frame = CGRect(x: rect.minX + 9, y: y, width: max(rect.width - 18, 0), height: 2)
  }

  // MARK: Building

  /// Copy's action and its two confirmations, the first the action.
  private static func copyLabels(_ kind: Kind) -> [String] {
    let strings = ShellStrings.shared
    return [
      kind == .screenshot
        ? strings.text(.captureCommandsCopyText) : strings.text(CaptureTextModeStringKey.copy),
      strings.text(.captureCommandsCopied), strings.text(.captureCommandsNoText),
    ]
  }

  private static func copyTooltip(_ kind: Kind) -> String {
    let strings = ShellStrings.shared
    return kind == .screenshot
      ? strings.text(.captureCommandsCopyTextTooltip)
      : strings.text(CaptureTextModeStringKey.copyTooltip)
  }

  /// Command `index`'s place on the row and its controls: its button, or for a command with
  /// options its button and chevron side by side as one split button.
  private static func unit(for command: Command, index: Int, options: Bool, _ kind: Kind)
    -> (view: NSView, controls: [NSControl])
  {
    let strings = ShellStrings.shared
    let button = AnnotationToolbarButton(
      label: command.name, image: nil, action: #selector(AnnotationCommandRow.commandClicked))
    button.tag = index
    button.toolTip =
      kind == .screenshot
      ? strings.text(.captureCommandsRunTooltip, command.name)
      : strings.text(CaptureTextModeStringKey.runTooltip, command.name)
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
  @objc private func copyClicked() { onCopy?() }
  @objc private func selectTextClicked() { onSelectText?() }
  @objc private func redactClicked() { onRedact?() }

  @objc private func commandClicked(_ sender: NSButton) {
    guard shown.indices.contains(sender.tag) else { return }
    onRun?(shown[sender.tag])
  }

  @objc private func optionsClicked(_ sender: ToolbarOptionsChevron) {
    guard shown.indices.contains(sender.tag) else { return }
    onOptions?(sender, shown[sender.tag])
  }
}
