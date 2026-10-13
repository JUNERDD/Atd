import Foundation

/// The options card the command island grows into while a command's options are chosen (the
/// `choose` phase): what it shows and what each key and click does, as values the island draws.
///
/// A command with a single choice option shows its values as a list: picking one runs the
/// command with it. Any other command shows a sheet, one row per option: a choice changes value
/// in place (Left/Right) or opens its values as a list inside the card (a drill-down, where a
/// pick returns to the sheet), a toggle flips, an input option is handed off to the panel's
/// command input page, and Return runs with what the sheet shows. A list of more than
/// ``filterThreshold`` values has a filter field; its rows never change the card's size, since
/// the card makes room for all of them (``capacity``) and scrolls past
/// ``IslandMetrics/maxVisibleRows``.
///
/// Keys the card does not take (``Response/ignored``) belong to the filter field, or to nothing.
public struct OptionsCard: Equatable, Sendable {
  /// What the card shows.
  public enum Page: Equatable, Sendable {
    /// The single choice's values.
    case list
    /// One row per option.
    case sheet
    /// The values of the sheet's choice at this index.
    case drill(Int)
  }

  /// The keys the card reads, as the island maps them from key presses.
  public enum Key: Equatable, Sendable {
    case up, down, tab, backTab, left, right, space, enter, escape
    /// Delete (Backspace), which goes back from a drill-down while its filter is empty.
    case delete
    /// ⌘[, which goes back from a drill-down.
    case back
    /// 1 to 9: picks that row of a list.
    case digit(Int)
  }

  /// What the card asks for once it is done.
  public enum Outcome: Equatable, Sendable {
    /// Run the command with these values.
    case run(CommandArguments)
    /// Fill the command's input options in the panel, starting from these values.
    case edit(CommandArguments)
    /// Close the card without running.
    case close
  }

  public enum Response: Equatable, Sendable {
    /// The card does not take the key: it goes on to the filter field.
    case ignored
    case handled
    case outcome(Outcome)
  }

  public enum Row: Equatable, Sendable {
    /// A value of the list's choice; `current` when it is the choice's value now.
    case value(CommandOption.Choice.Option, current: Bool)
    case option(CommandOption)
    /// The filter matches nothing.
    case noMatch
  }

  /// A list of more values than this has a filter field.
  public static let filterThreshold = 6

  /// The options with the values the card shows now.
  public private(set) var options: [CommandOption]
  public private(set) var page: Page
  /// The highlighted row, an index into ``rows``.
  public private(set) var selection: Int
  public private(set) var filter = ""
  /// The first row that shows, while the rows scroll.
  public private(set) var scroll = 0

  public init(options: [CommandOption]) {
    self.options = options
    page = .sheet
    selection = 0
    if options.count == 1, case .choice(let choice) = options[0] {
      page = .list
      selection = choice.options.firstIndex { $0.value == choice.value } ?? 0
    }
    reveal()
  }

  /// The values every option shows now, for a run or the panel.
  public var arguments: CommandArguments { CommandArguments(values: options) }

  /// The index of the choice whose values show: the single one, or the one drilled into.
  public var choiceIndex: Int? {
    switch page {
    case .list: 0
    case .drill(let index): index
    case .sheet: nil
    }
  }

  /// The choice whose values show.
  public var choice: CommandOption.Choice? {
    guard let index = choiceIndex, options.indices.contains(index),
      case .choice(let choice) = options[index]
    else { return nil }
    return choice
  }

  public var showsFilter: Bool { (choice?.options.count ?? 0) > Self.filterThreshold }

  /// The rows of the page: the matching values of a list, or the options of the sheet.
  public var rows: [Row] {
    guard let choice else { return options.map(Row.option) }
    let values = matching(choice)
    if values.isEmpty { return [.noMatch] }
    return values.map { .value($0, current: $0.value == choice.value) }
  }

  /// How many rows the card makes room for: every value of the list, or every option, up to
  /// ``IslandMetrics/maxVisibleRows``, so filtering never changes its size.
  public var capacity: Int {
    min(max(choice?.options.count ?? options.count, 1), IslandMetrics.maxVisibleRows)
  }

  /// The rows that show, by index.
  public var visible: Range<Int> { scroll..<min(scroll + capacity, rows.count) }

  /// The rows a key or the pointer can highlight: none while the filter matches nothing.
  private var selectable: Int { rows == [.noMatch] ? 0 : rows.count }

  // MARK: Keys

  public mutating func handle(_ key: Key) -> Response {
    switch key {
    case .up: move(by: -1, wrapping: false)
    case .down: move(by: 1, wrapping: false)
    case .tab: move(by: 1, wrapping: true)
    case .backTab: move(by: -1, wrapping: true)
    case .left, .right:
      guard page == .sheet else { return .ignored }
      change(by: key == .right ? 1 : -1)
    case .space:
      guard page == .sheet else { return .ignored }
      return open(selection)
    case .enter:
      return page == .sheet ? .outcome(.run(arguments)) : pick(selection)
    case .digit(let number):
      guard page != .sheet, (1...9).contains(number) else { return .ignored }
      return pick(number - 1)
    case .escape:
      if !filter.isEmpty {
        setFilter("")
      } else if case .drill = page {
        goBack()
      } else {
        return .outcome(.close)
      }
    case .delete:
      guard case .drill = page, filter.isEmpty else { return .ignored }
      goBack()
    case .back:
      guard case .drill = page else { return .ignored }
      goBack()
    }
    return .handled
  }

  // MARK: The pointer

  /// The pointer rests on `row`.
  public mutating func hover(_ row: Int) {
    guard row < selectable, row >= 0 else { return }
    selection = row
  }

  /// A click on `row`: a list picks it, a sheet opens it as Space does.
  public mutating func click(_ row: Int) -> Response {
    guard row < selectable, row >= 0 else { return .handled }
    selection = row
    return page == .sheet ? open(row) : pick(row)
  }

  /// The Run button: a list runs with its highlighted value, a sheet with what it shows; a
  /// drill-down has none.
  public mutating func runButton() -> Outcome? {
    switch page {
    case .sheet: return .run(arguments)
    case .list:
      if case .outcome(let outcome) = pick(selection) { return outcome }
      return nil
    case .drill: return nil
    }
  }

  /// Scrolls the rows by `delta` rows, within them.
  public mutating func scroll(by delta: Int) {
    let last = max(rows.count - capacity, 0)
    scroll = min(max(scroll + delta, 0), last)
  }

  /// The filter field changed: the first match is highlighted.
  public mutating func setFilter(_ text: String) {
    guard text != filter else { return }
    filter = text
    selection = 0
    scroll = 0
  }

  // MARK: Changes

  private mutating func move(by delta: Int, wrapping: Bool) {
    let count = selectable
    guard count > 0 else { return }
    let next = selection + delta
    selection = wrapping ? (next % count + count) % count : min(max(next, 0), count - 1)
    reveal()
  }

  /// Keeps the highlighted row among those that show.
  private mutating func reveal() {
    if selection < scroll { scroll = selection }
    if selection >= scroll + capacity { scroll = selection - capacity + 1 }
    scroll = min(max(scroll, 0), max(rows.count - capacity, 0))
  }

  /// Picks the value at `row` of a list: the single choice runs with it, a drill-down returns
  /// to the sheet with it.
  private mutating func pick(_ row: Int) -> Response {
    guard let index = choiceIndex, row >= 0, row < selectable,
      case .value(let value, _) = rows[row]
    else { return .handled }
    options[index] = options[index].choosing(value.value)
    guard page == .list else {
      goBack()
      return .handled
    }
    return .outcome(.run(arguments))
  }

  /// Space on a sheet row: a choice opens its values, a toggle flips, an input goes to the panel.
  private mutating func open(_ row: Int) -> Response {
    guard page == .sheet, options.indices.contains(row) else { return .handled }
    switch options[row] {
    case .choice(let choice):
      page = .drill(row)
      filter = ""
      scroll = 0
      selection = choice.options.firstIndex { $0.value == choice.value } ?? 0
      reveal()
    case .toggle(let toggle):
      options[row] = options[row].setting(!toggle.value)
    case .input:
      return .outcome(.edit(arguments))
    }
    return .handled
  }

  /// Left/Right on a sheet row: a choice moves to its previous or next value, round the list; a
  /// toggle turns off or on.
  private mutating func change(by delta: Int) {
    guard options.indices.contains(selection) else { return }
    switch options[selection] {
    case .choice(let choice):
      let count = choice.options.count
      guard count > 0 else { return }
      let current = choice.options.firstIndex { $0.value == choice.value }
      let next =
        current.map { (($0 + delta) % count + count) % count } ?? (delta > 0 ? 0 : count - 1)
      options[selection] = options[selection].choosing(choice.options[next].value)
    case .toggle:
      options[selection] = options[selection].setting(delta > 0)
    case .input:
      break
    }
  }

  /// From a drill-down back to the sheet, its choice highlighted.
  private mutating func goBack() {
    guard case .drill(let index) = page else { return }
    page = .sheet
    filter = ""
    scroll = 0
    selection = index
    reveal()
  }

  private func matching(_ choice: CommandOption.Choice) -> [CommandOption.Choice.Option] {
    let query = filter.trimmingCharacters(in: .whitespaces)
    guard !query.isEmpty else { return choice.options }
    return choice.options.filter {
      $0.label.localizedStandardContains(query) || $0.value.localizedStandardContains(query)
    }
  }
}

extension OptionsCard {
  /// What a row names `option` by: its parameter's label.
  public static func label(of option: CommandOption) -> String {
    switch option {
    case .choice(let choice): choice.label
    case .toggle(let toggle): toggle.label
    case .input(let input): input.label
    }
  }

  /// What a choice shows as its value: the label of the value it has, else the value itself.
  public static func valueLabel(of choice: CommandOption.Choice) -> String {
    choice.options.first { $0.value == choice.value }?.label ?? choice.value
  }
}

extension CommandOption {
  /// A choice set to `value`; any other option as it is.
  fileprivate func choosing(_ value: String) -> CommandOption {
    guard case .choice(let choice) = self else { return self }
    return .choice(
      .init(key: choice.key, label: choice.label, value: value, options: choice.options))
  }

  /// A toggle set to `value`; any other option as it is.
  fileprivate func setting(_ value: Bool) -> CommandOption {
    guard case .toggle(let toggle) = self else { return self }
    return .toggle(.init(key: toggle.key, label: toggle.label, value: value))
  }
}
