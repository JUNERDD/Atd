import AICore
import AppKit

/// The rows' menus: a command's options from its chevron, and More. The text row's offer Annotate
/// where the answer goes and run their commands on the picked text with the capture still open;
/// a launch that hands a command to Atd (Fill in Atd) ends the capture as the screenshot row's
/// do.
extension AnnotationCommandSlot {
  func menuLaunched(_ launch: CommandLaunch) {
    let fromText = menusFromText
    closeMenus()
    if fromText, launch.intent == .run {
      onTextRun?(launch)
    } else {
      onLaunch?(.command(launch))
    }
  }

  func openOptions(
    of command: SelectionToolbarSettings.Command, from chevron: ToolbarOptionsChevron, text: Bool
  ) {
    guard menus.opener !== chevron else { return closeMenus() }
    let label = ShellStrings.shared.text(.commandOptionsMenu, command.name)
    open(
      from: chevron, in: text ? textRow : row, column: chevron.superview ?? chevron, label: label,
      text: text
    ) { [weak self] in self?.options.items(for: command.id) ?? [] }
    guard menus.isOpen else { return }
    chevron.isActive = true
    activeChevron = chevron
  }

  /// Opens the "When done" menu from Ask Atd's split chevron on the Select Text row; picking an
  /// action remembers it and opens `AnnotationAskBar` focused for typing.
  func openAskOptions(from chevron: ToolbarOptionsChevron) {
    guard menus.opener !== chevron else { return closeMenus() }
    let strings = ShellStrings.shared
    let label = strings.text(.commandOptionsMenu, strings.text(.selectionToolbarAsk))
    open(
      from: chevron, in: textRow, column: chevron.superview ?? chevron, label: label, text: true
    ) { [weak self] in self?.askOutputItems(launchingAsk: true) ?? [] }
    guard menus.isOpen else { return }
    chevron.isActive = true
    activeChevron = chevron
  }

  /// Opens or closes the "When done" menu anchored to the destination button inside `AnnotationAskBar`.
  func openAskOutput(from button: NSButton) {
    guard menus.opener !== button else { return closeMenus() }
    let strings = ShellStrings.shared
    open(
      from: button, in: ask, column: button, label: strings.text(.commandOptionsOutput), text: true
    ) { [weak self] in self?.askOutputItems(launchingAsk: false) ?? [] }
    guard menus.isOpen else { return }
    ask?.setOutputMenuActive(true)
  }

  static func askOutputLabel(_ action: CommandOutputAction) -> String {
    CommandOutputChoice.Names(ShellStrings.shared.catalog).actions[action] ?? action.rawValue
  }

  private func askOutputItems(launchingAsk: Bool) -> [ToolbarMenuItem] {
    let names = CommandOutputChoice.Names(ShellStrings.shared.catalog)
    let options = CommandOutputChoice.appending(
      CommandOutputOption(value: askOutput, saved: .card, selection: true), to: [], names: names,
      cursor: setup?.cursor ?? true, screenshotText: true)
    guard case .choice(let choice) = options.first else { return [] }
    return choice.options.compactMap { option in
      guard let action = CommandOutputAction(rawValue: option.value) else { return nil }
      return ToolbarMenuItem(
        content: .init(title: option.label, mark: option.value == choice.value ? .check : .blank),
        action: { [weak self] in
          guard let self else { return }
          self.askOutput = action
          self.closeMenus()
          if launchingAsk {
            self.openAsk(keepingOutput: true)
          } else {
            self.ask?.configure(textMode: true, outputLabel: Self.askOutputLabel(action))
            self.ask?.focus()
          }
        })
    }
  }

  /// More: the commands that did not fit, each opening its options to the side, then the way to
  /// choose which commands sit on the row.
  func openMore(from more: NSButton, text: Bool) {
    guard menus.opener !== more else { return closeMenus() }
    let overflow = (text ? textRow : row)?.overflow ?? []
    let strings = ShellStrings.shared
    let customize = ToolbarMenuItem(
      content: .init(title: strings.text(.captureCommandsCustomize)),
      action: { [weak self] in
        self?.closeMenus()
        self?.setup?.openSettings()
      })
    open(
      from: more, in: text ? textRow : row, column: more,
      label: strings.text(.captureCommandsMoreTooltip), text: text
    ) { [weak self] in self?.options.moreItems(overflow, trailing: [customize]) ?? [] }
  }

  /// Opens the first panel under (or over) `barView`, aligned with `column`. The hover follows
  /// the pointer for the panels only: the bar's own buttons keep tracking it themselves in the
  /// overlay, which is the key window.
  private func open(
    from opener: NSView, in barView: NSView?, column: NSView, label: String, text: Bool,
    build: @escaping () -> [ToolbarMenuItem]
  ) {
    closeMenus()
    guard let barView, let window = barView.window else { return }
    menusFromText = text
    options.screenshotText = text
    let frame = window.convertToScreen(column.convert(column.bounds, to: nil))
    let capsule = window.convertToScreen(barView.convert(barView.bounds, to: nil))
    hover.start([], grip: nil, in: barView)
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

  func menusClosed() {
    activeChevron?.isActive = false
    activeChevron = nil
    ask?.setOutputMenuActive(false)
    options.reset()
    hover.stop()
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
    pressMonitor = nil
  }
}
