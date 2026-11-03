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

/// When a menu row's submenu opens and closes under a moving pointer, polled on every display
/// frame (the toolbar's hover). As in native menus, the submenu follows the row under the pointer
/// at once: a row with a submenu opens it, and once one is open another row swaps in its own (or,
/// without one, closes it). Only the pointer's way into the open submenu holds it: while each
/// step heads there, the rows it crosses wait, and after its last such step they wait
/// ``holdDelay`` more, so a pause on the way in does not lose it either; a step elsewhere ends
/// the hold. Being in the submenu, or away from the menu altogether, keeps it as it is.
///
/// A step heads into the submenu (as menu aim judges it) when, carried on to the submenu's edge
/// facing it, it meets that edge within the submenu's height, give or take ``aimSlack``.
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

  /// How long after its last step into the open submenu a pointer resting on another row keeps it.
  public static let holdDelay = 0.18
  /// How far the pointer moves, in points, before its path counts as a step.
  public static let aimStep = 2.0
  /// How far past the submenu's top and bottom a step may meet its edge and still head into it,
  /// in points: a hand's path toward it wobbles.
  public static let aimSlack = 16.0

  /// The row whose submenu is open.
  public private(set) var openRow: Int?
  /// When the pointer last stepped into the open submenu, while no step elsewhere has followed.
  private var heading: Double?
  /// Where the pointer's last step ended, on screen.
  private var trail: CGPoint?

  public init() {}

  /// The pointer is at `pointer` at `now` (seconds, any monotonic clock), at `location` on
  /// screen, with the open submenu's frame `submenu` (nil while none is open): the change to
  /// make, if any.
  public mutating func update(
    _ pointer: Pointer, at now: Double, location: CGPoint, submenu: CGRect?
  ) -> Change? {
    switch step(to: location, toward: submenu) {
    case true?: heading = now
    case false?: heading = nil
    case nil: break
    }
    guard case .row(let row, let opens) = pointer, row != openRow else { return nil }
    if openRow != nil, let heading, now - heading < Self.holdDelay { return nil }
    heading = nil
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
    heading = nil
  }

  /// The submenu closed by other means (a value was picked in it).
  public mutating func closed() {
    openRow = nil
    heading = nil
  }

  /// Whether the pointer, now at `location`, took a step into `submenu` (true) or elsewhere
  /// (false); nil when it took none. Movements shorter than ``aimStep`` add up until they make
  /// one, so a pointer at rest takes none.
  private mutating func step(to location: CGPoint, toward submenu: CGRect?) -> Bool? {
    guard let start = trail else {
      trail = location
      return nil
    }
    guard hypot(location.x - start.x, location.y - start.y) >= Self.aimStep else { return nil }
    trail = location
    return submenu.map { Self.heads(from: start, to: location, into: $0) } ?? false
  }

  /// Whether the step from `start` to `end`, carried on, meets the edge of `submenu` that faces
  /// it within the submenu's height and ``aimSlack``.
  static func heads(from start: CGPoint, to end: CGPoint, into submenu: CGRect) -> Bool {
    let edge: CGFloat
    if end.x <= submenu.minX {
      edge = submenu.minX
    } else if end.x >= submenu.maxX {
      edge = submenu.maxX
    } else {
      return false
    }
    let dx = end.x - start.x
    guard dx != 0, (edge - end.x) / dx >= 0 else { return false }
    let y = end.y + (edge - end.x) * (end.y - start.y) / dx
    return y >= submenu.minY - Self.aimSlack && y <= submenu.maxY + Self.aimSlack
  }
}
