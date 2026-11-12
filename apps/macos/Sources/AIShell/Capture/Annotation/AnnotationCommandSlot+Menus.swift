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
    open(from: chevron, column: chevron.superview ?? chevron, label: label, text: text) {
      [weak self] in self?.options.items(for: command.id) ?? []
    }
    guard menus.isOpen else { return }
    chevron.isActive = true
    activeChevron = chevron
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
    open(from: more, column: more, label: strings.text(.captureCommandsMoreTooltip), text: text) {
      [weak self] in self?.options.moreItems(overflow, trailing: [customize]) ?? []
    }
  }

  /// Opens the first panel under (or over) the row, aligned with `column`. The hover follows
  /// the pointer for the panels only: the row's own buttons keep tracking it themselves in the
  /// overlay, which is the key window.
  private func open(
    from opener: NSView, column: NSView, label: String, text: Bool,
    build: @escaping () -> [ToolbarMenuItem]
  ) {
    closeMenus()
    guard let row = text ? textRow : row, let window = row.window else { return }
    menusFromText = text
    options.screenshotText = text
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

  func menusClosed() {
    activeChevron?.isActive = false
    activeChevron = nil
    options.reset()
    hover.stop()
    if let pressMonitor { NSEvent.removeMonitor(pressMonitor) }
    pressMonitor = nil
  }
}
