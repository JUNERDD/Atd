import AICore
import AppKit

/// What the selection toolbar's menus show and do with commands' options (contract: selection
/// toolbar, mouse path), as items for ``ToolbarOptionsCascade``:
///
/// - A command whose only option is a choice (where the answer goes, for a command without
///   parameters) lists its values, the current one checked at the trailing edge; a click runs the
///   command with that value.
/// - Any other command gets a row per option: a choice shows its value and opens its values to
///   the side, where a pick changes the row and returns to it; a toggle flips in place; a text or
///   number option offers Fill in Atd, which hands the command to the panel's command input
///   page. Then a hairline and Run, with the values in a line, which runs with them.
/// - The More menu lists the commands that did not fit the capsule; a command with options opens
///   them to the side, and a click on its row runs it with its remembered values.
///
/// Every launch from the options carries all of the command's choice and toggle values. Values
/// picked without running are kept while the menus stay open (``reset()`` forgets them).
final class ToolbarOptionsContent {
  /// A menu launched a command; the owner hides the toolbar and hands it on.
  var onLaunch: ((CommandLaunch) -> Void)?
  /// The commands with options (`commandOptions.set`).
  var catalog = CommandOptionsCatalog()

  private unowned let cascade: ToolbarOptionsCascade
  /// The values picked so far per command id, since the menus opened.
  private var sheets: [String: ToolbarOptionsSheet] = [:]

  init(cascade: ToolbarOptionsCascade) {
    self.cascade = cascade
  }

  /// Forgets the values picked in the menus; the next ones start from the catalog's.
  func reset() {
    sheets = [:]
  }

  /// The More menu's rows for `commands`.
  func moreItems(_ commands: [SelectionToolbarSettings.Command]) -> [ToolbarMenuItem] {
    commands.map { command in
      let options = catalog.contains(command.id)
      return ToolbarMenuItem(
        content: .init(title: command.name, submenu: options),
        submenu: options ? { [weak self] in self?.items(for: command.id) ?? [] } : nil,
        action: { [weak self] in self?.onLaunch?(CommandLaunch(id: command.id)) })
    }
  }

  /// Command `id`'s options menu: its values or its rows; empty without options in the catalog.
  func items(for id: String) -> [ToolbarMenuItem] {
    guard let sheet = sheet(id) else { return [] }
    guard let choice = sheet.singleChoice else { return rows(of: sheet) }
    return values(of: choice) { [weak self] value in
      self?.change(id) { $0.pick(value, for: choice.key) }
      self?.launch(id, .run)
    }
  }

  // MARK: Items

  /// The rows sheet: a row per option, a hairline, then Run.
  private func rows(of sheet: ToolbarOptionsSheet) -> [ToolbarMenuItem] {
    let id = sheet.id
    let strings = ShellStrings.shared
    // With toggles, every row keeps the trailing slot their checkmarks take, so details line up.
    let mark: ToolbarOptionsRow.Content.Mark =
      sheet.options.contains {
        if case .toggle = $0 { true } else { false }
      } ? .blank : .none
    let options = sheet.options.map { option in
      switch option {
      case .choice(let choice):
        ToolbarMenuItem(
          content: .init(
            title: choice.label, detail: ToolbarOptionsSheet.valueLabel(choice),
            reserved: choice.options.map(\.label), mark: mark, submenu: true),
          submenu: { [weak self] in self?.choiceValues(id, key: choice.key) ?? [] })
      case .toggle(let toggle):
        ToolbarMenuItem(
          content: .init(title: toggle.label, mark: toggle.value ? .check : .blank, toggle: true),
          action: { [weak self] in
            self?.change(id) { $0.flip(toggle.key) }
            self?.cascade.refresh()
          })
      case .input(let input):
        ToolbarMenuItem(
          content: .init(
            title: input.label, detail: strings.text(.commandOptionsEdit), mark: mark),
          action: { [weak self] in self?.launch(id, .edit) })
      }
    }
    let summary = sheet.summary
    let run = ToolbarMenuItem(
      content: .init(
        title: strings.text(.commandOptionsRun), detail: summary.isEmpty ? nil : summary,
        mark: mark),
      action: { [weak self] in self?.launch(id, .run) })
    return options + [.separator, run]
  }

  /// The values of choice `key` as a side submenu of the rows sheet: a pick changes the row and
  /// closes the submenu, back to the sheet.
  private func choiceValues(_ id: String, key: String) -> [ToolbarMenuItem] {
    let choice = sheet(id)?.options.lazy.compactMap { option -> CommandOption.Choice? in
      if case .choice(let choice) = option, choice.key == key { return choice }
      return nil
    }.first
    guard let choice else { return [] }
    return values(of: choice) { [weak self] value in
      self?.change(id) { $0.pick(value, for: key) }
      self?.cascade.closeDeepest()
    }
  }

  /// A row per value of `choice`, the current one checked; a click calls `pick` with its value.
  private func values(
    of choice: CommandOption.Choice, pick: @escaping (String) -> Void
  ) -> [ToolbarMenuItem] {
    choice.options.map { option in
      ToolbarMenuItem(
        content: .init(title: option.label, mark: option.value == choice.value ? .check : .blank),
        action: { pick(option.value) })
    }
  }

  // MARK: Values

  /// Command `id`'s values so far, from the catalog until something is picked.
  private func sheet(_ id: String) -> ToolbarOptionsSheet? {
    if let sheet = sheets[id] { return sheet }
    guard let entry = catalog.entry(for: id) else { return nil }
    let sheet = ToolbarOptionsSheet(
      entry, names: CommandOutputChoice.Names(ShellStrings.shared.catalog))
    sheets[id] = sheet
    return sheet
  }

  private func change(_ id: String, _ update: (inout ToolbarOptionsSheet) -> Void) {
    guard var sheet = sheet(id) else { return }
    update(&sheet)
    sheets[id] = sheet
  }

  private func launch(_ id: String, _ intent: CommandLaunch.Intent) {
    guard let sheet = sheet(id) else { return }
    onLaunch?(sheet.launch(intent))
  }
}
