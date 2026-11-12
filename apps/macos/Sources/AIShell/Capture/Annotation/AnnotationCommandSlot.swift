import AICore
import AppKit

/// The style bar's slot while nothing is styled (architecture S1–S4, C5): one row at a time, the
/// screenshot's command row, text mode's text row (``AnnotationCommandRow``), or the ask field
/// (``AnnotationAskBar``) in the row's place. It owns the rows' menus, the selection toolbar's
/// (``ToolbarOptionsCascade``, ``ToolbarOptionsContent``), opened above the capture overlays
/// (``ToolbarWindow/aboveCapture``) and mouse only as there: the overlay keeps the keyboard,
/// Escape closes them first (``dismiss()``), and a press anywhere else in the app closes them and
/// goes no further, as a press outside a menu does. They also close whenever the row goes or a
/// tool is chosen. The text row's menus offer Annotate where the answer goes
/// (``ToolbarOptionsContent/screenshotText``), and running one of its commands keeps the capture
/// open (``onTextRun``).
///
/// Copy text, Copy and the auto-redact shortcut confirm in place, on their own buttons at their
/// reserved widths, and a confirmation is withdrawn as soon as it stops describing the screen
/// (``endFeedback()``).
final class AnnotationCommandSlot {
  enum Shown {
    case commands, text, ask
  }

  /// A command or a question to run on the screenshot: the session ends with it.
  var onLaunch: ((CaptureLaunch) -> Void)?
  /// A text command to run on the picked text, with the values its menu picked (none: the
  /// remembered ones): the capture stays open.
  var onTextRun: ((CommandLaunch) -> Void)?
  /// The ask field is opening: the editor drops its tool, its selection and open text.
  var onAskOpen: (() -> Void)?
  /// The ask field closed: the editor shows the row again and takes the keyboard back.
  var onAskClose: (() -> Void)?
  var onCopyText: (() -> Void)?
  var onSelectText: (() -> Void)?
  var onRedact: (() -> Void)?
  /// The text row's Copy.
  var onTextCopy: (() -> Void)?
  /// The scope chip's ×.
  var onScopeClear: (() -> Void)?
  /// The rows' result card toggle.
  var onToggleResults: (() -> Void)?
  /// The auto-redact shortcut's confirmation ended: the editor shows the count again.
  var onRedactionFeedbackEnd: (() -> Void)?
  /// The row or the field being dragged by its surface.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)?

  private(set) var setup: CaptureCommandRowSetup?
  private(set) var row: AnnotationCommandRow?
  private(set) var textRow: AnnotationCommandRow?
  private(set) var ask: AnnotationAskBar?
  private(set) var isAsking = false
  /// Copy text was clicked while the text was still being read: it copies once it is.
  var copyPending = false
  let hover = SelectionToolbarHover()
  let menus: ToolbarOptionsCascade
  let options: ToolbarOptionsContent
  /// The chevron whose options menu is open.
  weak var activeChevron: ToolbarOptionsChevron?
  /// The open menus belong to the text row: a run from them keeps the capture open.
  var menusFromText = false
  /// Closes the menus on a press outside them while they are open.
  var pressMonitor: Any?
  /// Ends Copy text's or Copy's confirmation after a moment.
  private var feedback: Task<Void, Never>?
  /// Ends the auto-redact shortcut's confirmation, and what it shows otherwise.
  private var redactFeedback: Task<Void, Never>?
  private var redaction = AnnotationCommandRow.Redaction.hidden

  init() {
    menus = ToolbarOptionsCascade(hover: hover, level: ToolbarWindow.aboveCapture)
    options = ToolbarOptionsContent(cascade: menus)
    hover.onFrame = { [weak self] view in self?.menus.pointerAt(view) }
    options.onLaunch = { [weak self] launch in self?.menuLaunched(launch) }
    options.onPick = { [weak self] id, values in self?.setup?.onPick(id, values) }
    menus.onClose = { [weak self] in self?.menusClosed() }
  }

  /// Builds the rows for `setup` (nil: none), each no wider than `maxWidth`, in the current
  /// language.
  func prepare(_ setup: CaptureCommandRowSetup?, maxWidth: CGFloat) {
    hide()
    self.setup = setup
    guard let setup else { return }
    options.catalog = setup.catalog
    options.cursor = setup.cursor
    let hasOptions = { setup.catalog.contains($0) }
    let row = AnnotationCommandRow(
      kind: .screenshot, commands: setup.commands, hasOptions: hasOptions, maxWidth: maxWidth)
    let textRow = AnnotationCommandRow(
      kind: .text, commands: setup.textCommands, hasOptions: hasOptions, maxWidth: maxWidth)
    for (shown, view) in [(false, row), (true, textRow)] {
      view.onAsk = { [weak self] in self?.openAsk() }
      view.onOptions = { [weak self] chevron, command in
        self?.openOptions(of: command, from: chevron, text: shown)
      }
      view.onMore = { [weak self] more in self?.openMore(from: more, text: shown) }
      view.onToggleResults = { [weak self] in self?.onToggleResults?() }
      view.onDrag = { [weak self] in self?.onDrag?($0) }
    }
    row.onRun = { [weak self] command in self?.onLaunch?(.command(CommandLaunch(id: command.id))) }
    row.onCopy = { [weak self] in self?.onCopyText?() }
    row.onSelectText = { [weak self] in self?.onSelectText?() }
    row.onRedact = { [weak self] in self?.onRedact?() }
    textRow.onRun = { [weak self] command in self?.onTextRun?(CommandLaunch(id: command.id)) }
    textRow.onCopy = { [weak self] in self?.onTextCopy?() }
    textRow.onScopeClear = { [weak self] in self?.onScopeClear?() }
    let ask = AnnotationAskBar()
    ask.onSubmit = { [weak self] question in self?.onLaunch?(.ask(question)) }
    ask.onClose = { [weak self] in self?.closeAsk() }
    ask.onDrag = { [weak self] in self?.onDrag?($0) }
    self.row = row
    self.textRow = textRow
    self.ask = ask
    redaction = .hidden
  }

  /// Updates the focused field's state when `WriteTargets` finishes after the row was built.
  func updateCursor(_ cursor: Bool, app: String?) {
    setup?.cursor = cursor
    setup?.cursorApp = app
    options.cursor = cursor
  }

  /// `/`: the row turns into the field; false without a row or with the field already open.
  func askFromKey() -> Bool {
    guard row != nil, !isAsking else { return false }
    openAsk()
    return true
  }

  /// The slot's views, which go in the bars' host.
  var views: [NSView] { [row, textRow, ask].compactMap(\.self) }

  /// The room the slot needs: the widest of the rows (each with every part showing) and the
  /// field; zero without a row.
  var size: NSSize {
    guard let row, let textRow, let ask else { return .zero }
    let sizes = [row.reservedSize, textRow.reservedSize, ask.fittingSize]
    return NSSize(
      width: sizes.map(\.width).max() ?? 0, height: sizes.map(\.height).max() ?? 0)
  }

  /// Shows one row or the field; nil shows none (the style bar has the slot).
  func show(_ shown: Shown?) {
    let menusShown: Shown? = menus.isOpen ? (menusFromText ? .text : .commands) : nil
    if menusShown != nil, menusShown != shown { closeMenus() }
    row?.isHidden = shown != .commands
    textRow?.isHidden = shown != .text
    ask?.isHidden = shown != .ask
  }

  /// Puts the rows and the field, each at its own size, at `origin` in the bars' host.
  func place(at origin: CGPoint) {
    for view in views { view.frame = CGRect(origin: origin, size: view.fittingSize) }
  }

  /// Escape: closes the menus, else the field; false when neither was open.
  func dismiss() -> Bool {
    if menus.isOpen {
      closeMenus()
      return true
    }
    guard isAsking else { return false }
    closeAsk()
    return true
  }

  /// A tool was chosen: menus and the field close, and feedback ends.
  func toolChanged() {
    endFeedback()
    closeMenus()
    if isAsking { closeAsk() }
  }

  func closeMenus() {
    menus.close()
  }

  /// Takes the rows and the field away, with their menus and feedback.
  func hide() {
    closeMenus()
    endFeedback()
    redactFeedback?.cancel()
    redactFeedback = nil
    for view in views { view.removeFromSuperview() }
    row = nil
    textRow = nil
    ask = nil
    setup = nil
    isAsking = false
    copyPending = false
  }

  // MARK: The rows' states

  /// Select Text: disabled once the selection was read and holds no text (`false`).
  func setSelectText(hasText: Bool?) { row?.setSelectText(hasText: hasText) }

  /// The text row's scope chip.
  func setScope(_ label: String) { textRow?.setScope(label) }

  /// Both rows' result card toggle: shown once a run started, lit while the card shows.
  func setResults(visible: Bool, isOpen: Bool) {
    row?.setResults(visible: visible, isOpen: isOpen)
    textRow?.setResults(visible: visible, isOpen: isOpen)
  }

  /// The running bar under text command `id` (nil: none runs).
  func setRunning(_ id: String?) { textRow?.setRunning(id) }

  /// The auto-redact shortcut while `count` sensitive items are unmasked: shown only while there
  /// are any, unless it is confirming (decision D7).
  func setRedaction(count: Int) {
    guard redactFeedback == nil else { return }
    let next: AnnotationCommandRow.Redaction = count > 0 ? .cover(count) : .hidden
    guard next != redaction else { return }
    redaction = next
    row?.setRedaction(next)
  }

  /// The shortcut says for ``CommandProgressState/doneDuration`` that `count` items were just
  /// covered, with `tooltip`, then follows the count again.
  func confirmRedaction(count: Int, tooltip: String) {
    redactFeedback?.cancel()
    redaction = .done(count)
    row?.setRedaction(.done(count))
    row?.setRedactionTooltip(tooltip)
    redactFeedback = Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard !Task.isCancelled else { return }
      self?.endRedactionFeedback()
    }
  }

  /// Withdraws the shortcut's confirmation; the editor shows the count again on its next refresh.
  func endRedactionFeedback() {
    guard let redactFeedback else { return }
    redactFeedback.cancel()
    self.redactFeedback = nil
    redaction = .hidden
    row?.setRedaction(.hidden)
    onRedactionFeedbackEnd?()
  }

  // MARK: Ask

  private func openAsk() {
    guard let ask else { return }
    closeMenus()
    endFeedback()
    isAsking = true
    onAskOpen?()
    ask.focus()
  }

  private func closeAsk() {
    isAsking = false
    ask?.reset()
    onAskClose?()
  }

  // MARK: Copy

  /// Shows on Copy text (or the text row's Copy, `text`) what it just did, then its action again
  /// after a moment.
  func confirmCopy(_ state: AnnotationCommandRow.CopyState, tooltip: String, text: Bool = false) {
    feedback?.cancel()
    (text ? textRow : row)?.showCopy(state, tooltip: tooltip)
    feedback = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1.6))
      guard !Task.isCancelled else { return }
      self?.endFeedback()
    }
  }

  /// Withdraws Copy text's and Copy's confirmations (the selection moved, a tool or undo changed
  /// things, or the field opened).
  func endFeedback() {
    guard let feedback else { return }
    feedback.cancel()
    self.feedback = nil
    row?.showCopy(.idle)
    textRow?.showCopy(.idle)
  }
}
