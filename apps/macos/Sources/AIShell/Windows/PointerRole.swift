import AppKit

/// What a press does where the pointer rests, which decides the cursor a native surface shows
/// there. The shell follows the renderer's pointer preference (shadcn `--pointer`): an enabled
/// target whose click acts shows the pointing hand whatever it looks like (a button, capsule,
/// chip, menu row, option or clickable row), and the arrow stays where a click does nothing or
/// only moves focus. Sliders and scrubbers keep the arrow, as the renderer's `Slider` does, and
/// menus AppKit draws keep their own. Surfaces name a role rather than a cursor, so this is the
/// one place that maps them.
enum PointerRole {
  /// A click acts: a button, chip, menu row, option or clickable row.
  case action
  /// Only hover matters (a preview, a tooltip); a click does nothing or only moves focus.
  case passive
  /// A press drags the window or the item.
  case grab
  /// A drag is moving the window or the item.
  case grabbing
  /// A drag trims or resizes along x.
  case resizeColumn
  /// A drag trims or resizes along y.
  case resizeRow

  /// An AppKit button's role: it acts on a click while it is enabled.
  init(button: NSButton) { self = button.isEnabled ? .action : .passive }

  var cursor: NSCursor {
    switch self {
    case .action: .pointingHand
    case .passive: .arrow
    case .grab: .openHand
    case .grabbing: .closedHand
    case .resizeColumn: .columnResize
    case .resizeRow: .rowResize
    }
  }
}
