import AICore
import AppKit

/// The style bar's slot while nothing is styled (architecture S1–S4, C5): the screenshot's
/// command row (``AnnotationCommandRow``), or its ask field (``AnnotationAskBar``) in the row's
/// place. It owns the row's menus, the selection toolbar's (``ToolbarOptionsCascade``,
/// ``ToolbarOptionsContent``), opened above the capture overlays (``ToolbarWindow/aboveCapture``)
/// and mouse only as there: the overlay keeps the keyboard, Escape closes them first
/// (``dismiss()``), and a press anywhere else in the app closes them and goes no further, as a
/// press outside a menu does. They also close whenever the row goes or a tool is chosen.
///
/// Copy text confirms in place, on its own button at its reserved width, and the confirmation is
/// withdrawn as soon as it stops describing the screen (``endFeedback()``).
final class AnnotationCommandSlot {
  enum Shown {
    case commands, ask
  }

  /// A command or a question to run on the screenshot: the session ends with it.
  var onLaunch: ((CaptureLaunch) -> Void)?
  /// The ask field is opening: the editor drops its tool, its selection and open text.
  var onAskOpen: (() -> Void)?
  /// The ask field closed: the editor shows the row again and takes the keyboard back.
  var onAskClose: (() -> Void)?
  var onCopyText: (() -> Void)?
  /// The row or the field being dragged by its surface.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)?

  private(set) var setup: CaptureCommandRowSetup?
  private(set) var row: AnnotationCommandRow?
  private(set) var ask: AnnotationAskBar?
  private(set) var isAsking = false
  /// Copy text was clicked while the text was still being read: it copies once it is.
  var copyPending = false
  private let hover = SelectionToolbarHover()
  private let menus: ToolbarOptionsCascade
  private let options: ToolbarOptionsContent
  /// The chevron whose options menu is open.
  private weak var activeChevron: ToolbarOptionsChevron?
  /// Closes the menus on a press outside them while they are open.
  private var pressMonitor: Any?
  /// Ends Copy text's confirmation after a moment.
  private var feedback: Task<Void, Never>?

  init() {
    menus = ToolbarOptionsCascade(hover: hover, level: ToolbarWindow.aboveCapture)
    options = ToolbarOptionsContent(cascade: menus)
    hover.onFrame = { [weak self] view in self?.menus.pointerAt(view) }
    options.onLaunch = { [weak self] launch in
      self?.closeMenus()
      self?.onLaunch?(.command(launch))
    }
    options.onPick = { [weak self] id, values in self?.setup?.onPick(id, values) }
    menus.onClose = { [weak self] in self?.menusClosed() }
  }

  /// Builds the row for `setup` (nil: none), no wider than `maxWidth`, in the current language.
  func prepare(_ setup: CaptureCommandRowSetup?, maxWidth: CGFloat) {
    hide()
    self.setup = setup
    guard let setup else { return }
    options.catalog = setup.catalog
    options.cursor = setup.cursor
    let row = AnnotationCommandRow(
      commands: setup.commands, hasOptions: { setup.catalog.contains($0) }, maxWidth: maxWidth)
    row.onAsk = { [weak self] in self?.openAsk() }
    row.onRun = { [weak self] command in self?.onLaunch?(.command(CommandLaunch(id: command.id))) }
    row.onOptions = { [weak self] chevron, command in
      self?.openOptions(of: command, from: chevron)
    }
    row.onMore = { [weak self] more in self?.openMore(from: more) }
    row.onCopyText = { [weak self] in self?.onCopyText?() }
    let ask = AnnotationAskBar()
    ask.onSubmit = { [weak self] question in self?.onLaunch?(.ask(question)) }
    ask.onClose = { [weak self] in self?.closeAsk() }
    row.onDrag = { [weak self] in self?.onDrag?($0) }
    ask.onDrag = { [weak self] in self?.onDrag?($0) }
    self.row = row
    self.ask = ask
  }

  /// `/`: the row turns into the field; false without a row or with the field already open.
  func askFromKey() -> Bool {
    guard row != nil, !isAsking else { return false }
    openAsk()
    return true
  }

  /// The slot's views, which go in the bars' host.
  var views: [NSView] { [row, ask].compactMap(\.self) }

  /// The room the slot needs: the wider of the row and the field; zero without a row.
  var size: NSSize {
    guard let row, let ask else { return .zero }
    return NSSize(
      width: max(row.fittingSize.width, ask.fittingSize.width),
      height: max(row.fittingSize.height, ask.fittingSize.height))
  }

  /// Shows the row or the field; nil shows neither (the style bar has the slot).
  func show(_ shown: Shown?) {
    if shown != .commands { closeMenus() }
    row?.isHidden = shown != .commands
    ask?.isHidden = shown != .ask
  }

  /// Puts the row and the field, each at its own size, at `origin` in the bars' host.
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

  /// Takes the row and the field away, with their menus and feedback.
  func hide() {
    closeMenus()
    endFeedback()
    for view in views { view.removeFromSuperview() }
    row = nil
    ask = nil
    setup = nil
    isAsking = false
    copyPending = false
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

  // MARK: Copy text

  /// Shows on Copy text what it just did, then its action again after a moment.
  func confirmCopy(_ state: AnnotationCommandRow.CopyState, tooltip: String) {
    feedback?.cancel()
    row?.showCopy(state, tooltip: tooltip)
    feedback = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1.6))
      guard !Task.isCancelled else { return }
      self?.endFeedback()
    }
  }

  /// Withdraws Copy text's confirmation (the selection moved, a tool or undo changed things, or
  /// the field opened).
  func endFeedback() {
    guard let feedback else { return }
    feedback.cancel()
    self.feedback = nil
    row?.showCopy(.idle)
  }

  // MARK: Menus

  private func openOptions(
    of command: SelectionToolbarSettings.Command, from chevron: ToolbarOptionsChevron
  ) {
    guard menus.opener !== chevron else { return closeMenus() }
    let label = ShellStrings.shared.text(.commandOptionsMenu, command.name)
    open(from: chevron, column: chevron.superview ?? chevron, label: label) { [weak self] in
      self?.options.items(for: command.id) ?? []
    }
    guard menus.isOpen else { return }
    chevron.isActive = true
    activeChevron = chevron
  }

  /// More: the commands that did not fit, each opening its options to the side, then the way to
  /// choose which commands sit on the row.
  private func openMore(from more: NSButton) {
    guard menus.opener !== more else { return closeMenus() }
    let overflow = row?.overflow ?? []
    let strings = ShellStrings.shared
    let customize = ToolbarMenuItem(
      content: .init(title: strings.text(.captureCommandsCustomize)),
      action: { [weak self] in
        self?.closeMenus()
        self?.setup?.openSettings()
      })
    open(from: more, column: more, label: strings.text(.captureCommandsMoreTooltip)) {
      [weak self] in self?.options.moreItems(overflow, trailing: [customize]) ?? []
    }
  }

  /// Opens the first panel under (or over) the row, aligned with `column`. The hover follows
  /// the pointer for the panels only: the row's own buttons keep tracking it themselves in the
  /// overlay, which is the key window.
  private func open(
    from opener: NSView, column: NSView, label: String,
    build: @escaping () -> [ToolbarMenuItem]
  ) {
    closeMenus()
    guard let row, let window = row.window else { return }
    let frame = window.convertToScreen(column.convert(column.bounds, to: nil))
    let capsule = window.convertToScreen(row.convert(row.bounds, to: nil))
    hover.start([], grip: nil, in: row)
    menus.open(
      from: opener,
      anchor: NSRect(x: frame.minX, y: capsule.minY, width: frame.width, height: capsule.height),
      label: label, build: build)
    guard menus.isOpen else { return hover.stop() }
    pressMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) {
      [weak self] event in
      MainActor.assumeIsolated { self?.pressed(event) ?? true } ? event : nil
    }
  }

  /// A press while the menus are open: one in a panel or on the button that opened them is
  /// theirs (the button closes them again); any other closes them and goes no further.
  private func pressed(_ event: NSEvent) -> Bool {
    if event.window is ToolbarWindow { return true }
    if let opener = menus.opener, event.window === opener.window,
      opener.bounds.contains(opener.convert(event.locationInWindow, from: nil))
    {
      return true
    }
    closeMenus()
    return false
  }

  private func menusClosed() {
    activeChevron?.isActive = false
    activeChevron = nil
    options.reset()
    hover.stop()
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
    pressMonitor = nil
  }
}
