import Foundation

/// `ComputerKeyNameSchema`: the closed set of keys a `key` step may press. Anything outside it
/// (media keys, raw key codes) is malformed rather than guessed at.
public enum ComputerKeyName: String, Codable, CaseIterable, Sendable {
  case `return`
  case tab
  case escape
  case up
  case down
  case left
  case right
  case space
  case delete
  case home
  case end
  case pageup
  case pagedown
  case f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12
  case a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z
  case digit0 = "0"
  case digit1 = "1"
  case digit2 = "2"
  case digit3 = "3"
  case digit4 = "4"
  case digit5 = "5"
  case digit6 = "6"
  case digit7 = "7"
  case digit8 = "8"
  case digit9 = "9"

  /// A letter or a digit, the only keys `shift` may accompany while the step stays `input`.
  public var isCharacter: Bool { rawValue.count == 1 }

  /// `NAV`: keys that move focus or the caret without changing content.
  public var isNavigation: Bool {
    switch self {
    case .tab, .up, .down, .left, .right, .home, .end, .pageup, .pagedown: true
    default: false
    }
  }

  /// `TYPING`: keys that edit text the way typing does. `escape`, `return` and the function keys
  /// are neither navigation nor typing, so pressing them is `invoke`.
  public var isTyping: Bool { isCharacter || self == .space || self == .delete }
}

/// `ComputerModifierSchema`.
public enum ComputerModifier: String, Codable, CaseIterable, Sendable {
  case cmd
  case shift
  case option
  case ctrl
}
