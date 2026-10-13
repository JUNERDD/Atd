import Foundation

/// One command's options as the selection toolbar's options menu shows them, with the values
/// picked so far. They start as the catalog's (``CommandOptionsCatalog``, remembered values
/// applied) and change as the user picks a choice's value or flips a toggle in the menu; nothing
/// runs until a launch is made from them, which always carries every choice and toggle, so the
/// page never has to merge a partial set.
public struct ToolbarOptionsSheet: Equatable, Sendable {
  public let id: String
  /// The command's name, user data shown untranslated.
  public let name: String
  /// The options in parameter order, then where the answer goes, with their current values.
  public private(set) var options: [CommandOption]

  public init(_ entry: CommandOptionsCatalog.Entry, names: CommandOutputChoice.Names) {
    id = entry.id
    name = entry.name
    options = entry.options(names)
  }

  /// The command's only option when it is a choice (where the answer goes, for a command without
  /// parameters): its menu lists the values, and picking one runs the command with it. Any other
  /// command gets the rows sheet.
  public var singleChoice: CommandOption.Choice? {
    guard options.count == 1, case .choice(let choice) = options[0] else { return nil }
    return choice
  }

  /// Every choice's and toggle's current value.
  public var arguments: CommandArguments { CommandArguments(values: options) }

  /// The command launched with the current values.
  public func launch(_ intent: CommandLaunch.Intent) -> CommandLaunch {
    CommandLaunch(id: id, arguments: arguments, intent: intent)
  }

  /// Sets choice `key` to `value`; a value the choice does not offer, or a key that is no
  /// choice, changes nothing.
  public mutating func pick(_ value: String, for key: String) {
    options = options.map { option in
      guard case .choice(let choice) = option, choice.key == key,
        choice.options.contains(where: { $0.value == value })
      else { return option }
      return .choice(
        .init(key: choice.key, label: choice.label, value: value, options: choice.options))
    }
  }

  /// Turns toggle `key` over; a key that is no toggle changes nothing.
  public mutating func flip(_ key: String) {
    options = options.map { option in
      guard case .toggle(let toggle) = option, toggle.key == key else { return option }
      return .toggle(.init(key: toggle.key, label: toggle.label, value: !toggle.value))
    }
  }

  /// The values in a line for the Run row: each parameter choice's current value, then the label
  /// of each toggle that is on, in option order, as the page's values summary. A choice without a
  /// value adds nothing, nor does where the answer goes, which its own row shows; empty when there
  /// is nothing to show.
  public var summary: String {
    var choices: [String] = []
    var toggles: [String] = []
    for option in options {
      switch option {
      case .choice(let choice) where CommandOutputChoice.holds(choice): break
      case .choice(let choice):
        let label = Self.valueLabel(choice)
        if !label.isEmpty { choices.append(label) }
      case .toggle(let toggle) where toggle.value: toggles.append(toggle.label)
      case .toggle, .input: break
      }
    }
    return (choices + toggles).joined(separator: " · ")
  }

  /// The label of a choice's current value; the value itself when no option carries it.
  public static func valueLabel(_ choice: CommandOption.Choice) -> String {
    choice.options.first { $0.value == choice.value }?.label ?? choice.value
  }
}

/// When a menu row's submenu opens and closes under a resting or moving pointer, polled on every
/// display frame (the toolbar's hover): a row with a submenu opens it after ``openDelay`` of
/// rest; once one is open, moving onto another row closes it (or swaps in that row's submenu)
/// only after ``closeDelay``, so a pointer crossing other rows on its way into the submenu does
/// not lose it. Being in the submenu, or away from the menu altogether, keeps it as it is.
public struct ToolbarOptionsSubmenuIntent: Equatable, Sendable {
  /// Where the pointer is, for this menu.
  public enum Pointer: Equatable, Sendable {
    /// Neither on one of this menu's rows nor in its submenu: off the menus, or on a gap.
    case away
    /// In this menu's submenu, or deeper.
    case inSubmenu
    /// On row `index`; `opens` when the row has a submenu.
    case row(Int, opens: Bool)
  }

  public enum Change: Equatable, Sendable {
    /// Open row `index`'s submenu, closing any other.
    case open(Int)
    /// Close the open submenu.
    case close
  }

  public static let openDelay = 0.09
  public static let closeDelay = 0.18

  /// The row whose submenu is open.
  public private(set) var openRow: Int?
  /// The row the pointer rests on that would change the submenu, and since when.
  private var pending: Pending?

  private struct Pending: Equatable, Sendable {
    let row: Int
    let since: Double
  }

  public init() {}

  /// The pointer is at `pointer` at `now` (seconds, any monotonic clock): the change to make,
  /// if any.
  public mutating func update(_ pointer: Pointer, at now: Double) -> Change? {
    guard case .row(let row, let opens) = pointer, row != openRow else {
      pending = nil
      return nil
    }
    if pending?.row != row { pending = Pending(row: row, since: now) }
    let delay = openRow == nil ? Self.openDelay : Self.closeDelay
    guard let pending, now - pending.since >= delay else { return nil }
    self.pending = nil
    if opens {
      openRow = row
      return .open(row)
    }
    guard openRow != nil else { return nil }
    openRow = nil
    return .close
  }

  /// A click opened row `row`'s submenu at once.
  public mutating func opened(_ row: Int) {
    openRow = row
    pending = nil
  }

  /// The submenu closed by other means (a value was picked in it).
  public mutating func closed() {
    openRow = nil
    pending = nil
  }
}
