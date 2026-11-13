import AICore
import AppKit

/// One of the screenshot's command rows (architecture S1), on the shared glass capsule; the slot
/// shows one at a time (``AnnotationCommandSlot``).
///
/// - The screenshot row: once a text run started, the result card toggle, then after a hairline
///   Ask Atd, a button per command placed on the screenshot toolbar while the row stays within
///   `maxWidth` (a command with options is a split button whose chevron opens them, as on the
///   selection toolbar), More, then after a hairline Copy text and Select Text (text mode's way
///   in), and after another the shortcut to auto-redact, shown only while it has something to
///   cover or says it just did (decision D7).
/// - The text row, while text mode is on: the scope chip (what a command reads, with × to clear
///   the picks) and, once a run started, the result card toggle, then after a hairline Ask Atd,
///   the commands placed on `screenshotText` the same way, More, then after another hairline Copy.
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
  var onAskOptions: ((ToolbarOptionsChevron) -> Void)?
  var onRun: ((Command) -> Void)?
  var onOptions: ((ToolbarOptionsChevron, Command) -> Void)?
  var onMore: ((NSButton) -> Void)?
  var onCopy: (() -> Void)?
  var onSelectText: (() -> Void)?
  var onRedact: (() -> Void)?
  var onToggleResults: (() -> Void)?
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
  private(set) var buttons: [String: NSButton] = [:]
  let more: AnnotationToolbarButton
  let copy: AnnotationToolbarButton
  let selectText: AnnotationToolbarButton?
  let redact: AnnotationToolbarButton?
  let results: AnnotationToolbarButton
  let scope: AnnotationScopeChip?
  let runBar = AnnotationRunBar()
  /// The button the running bar sits under.
  weak var running: NSView?
  let bar: AnnotationGlassBar
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
    let results = AnnotationToolbarButton(
      selection: .washToggle, action: #selector(resultsClicked))
    let resultsName = strings.text(CaptureTextModeStringKey.results)
    results.image = AnnotationIcons.glyph(AnnotationIcons.results, label: resultsName)
    results.toolTip = strings.text(CaptureTextModeStringKey.resultsTooltip)
    results.setAccessibilityLabel(resultsName)
    self.results = results
    var controls: [NSControl] = [results, ask, more, copy]
    let askUnit: NSView
    if kind == .text {
      let askChevron = ToolbarOptionsChevron(action: #selector(askOptionsClicked))
      let askMenuLabel = strings.text(.commandOptionsMenu, strings.text(.selectionToolbarAsk))
      askChevron.toolTip = askMenuLabel
      askChevron.setAccessibilityLabel(askMenuLabel)
      let split = NSStackView(views: [ask, askChevron])
      split.spacing = 0
      askUnit = split
      controls.append(askChevron)
      buttons[CaptureTextRun.askID] = ask
    } else {
      askUnit = ask
    }
    var fixed: [NSView] = [results, askUnit, more, copy]
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
      groups = [[results], [askUnit, more], [copy, select], [redact]]
    case .text:
      let chip = AnnotationScopeChip()
      selectText = nil
      redact = nil
      scope = chip
      fixed += [chip]
      groups = [[chip, results], [askUnit, more], [copy]]
    }
    // The row with its fixed parts alone: 2 pt between neighbours of a group, 13 pt for each
    // hairline with its gaps. Each command adds its part and a gap while it fits.
    let padding = AnnotationGlassBar.padding
    var width = padding * 2 + fixed.map(\.fittingSize.width).reduce(0, +)
    width += groups.map { CGFloat(max($0.count - 1, 0)) * 2 }.reduce(0, +)
    width += CGFloat(groups.count - 1) * 13
    var units: [NSView] = []
    controls += [selectText, redact].compactMap(\.self)
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
    groups[1] = [askUnit] + units + [more]
    bar = AnnotationGlassBar(groups: groups, blending: .withinWindow)
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    reservedSize = widestSize()
    for control in controls { control.target = self }
    addSubview(bar)
    runBar.isHidden = true
    addSubview(runBar)
    if kind == .screenshot { setRedaction(.hidden) }
    setResults(visible: false, isOpen: false)
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
    bar.layoutSubtreeIfNeeded()
    placeRunBar()
  }

  // MARK: Building

  /// Copy's action and its two confirmations, the first the action.
  static func copyLabels(_ kind: Kind) -> [String] {
    let strings = ShellStrings.shared
    return [
      kind == .screenshot
        ? strings.text(.captureCommandsCopyText) : strings.text(CaptureTextModeStringKey.copy),
      strings.text(.captureCommandsCopied), strings.text(.captureCommandsNoText),
    ]
  }

  static func copyTooltip(_ kind: Kind) -> String {
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
  @objc private func askOptionsClicked(_ sender: ToolbarOptionsChevron) { onAskOptions?(sender) }
  @objc private func moreClicked(_ sender: NSButton) { onMore?(sender) }
  @objc private func copyClicked() { onCopy?() }
  @objc private func selectTextClicked() { onSelectText?() }
  @objc private func redactClicked() { onRedact?() }
  @objc private func resultsClicked() { onToggleResults?() }

  @objc private func commandClicked(_ sender: NSButton) {
    guard shown.indices.contains(sender.tag) else { return }
    onRun?(shown[sender.tag])
  }

  @objc private func optionsClicked(_ sender: ToolbarOptionsChevron) {
    guard shown.indices.contains(sender.tag) else { return }
    onOptions?(sender, shown[sender.tag])
  }
}
