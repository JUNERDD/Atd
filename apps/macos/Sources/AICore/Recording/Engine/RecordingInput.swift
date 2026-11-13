import Foundation

/// The modifier keys held with a recorded key, drawn in the system's order (⌃⌥⇧⌘).
public struct RecordingModifiers: OptionSet, Hashable, Sendable {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }

  public static let control = RecordingModifiers(rawValue: 1 << 0)
  public static let option = RecordingModifiers(rawValue: 1 << 1)
  public static let shift = RecordingModifiers(rawValue: 1 << 2)
  public static let command = RecordingModifiers(rawValue: 1 << 3)

  /// The held modifiers as menu glyphs, empty for none.
  public var symbols: String {
    [(Self.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘")]
      .filter { contains($0.0) }.map(\.1).joined()
  }

  /// Whether the press is a shortcut rather than typing: ⌘ or ⌃ is held.
  public var makesShortcut: Bool { contains(.command) || contains(.control) }
}

/// A key as a recording shows it: in a key badge, a step and the context file.
public enum RecordingKey: Hashable, Sendable {
  /// A key that types: the character its key cap shows, upper-cased for a letter.
  case character(String)
  case space, returnKey, tab, delete, forwardDelete, escape
  case left, right, up, down, home, end, pageUp, pageDown
  /// F1 to F20.
  case function(Int)

  /// The glyph a key badge shows, as the system's menus draw it; nil for ``space``, which is a
  /// word the shell translates.
  public var symbol: String? {
    switch self {
    case .character(let text): text
    case .space: nil
    case .returnKey: "↩"
    case .tab: "⇥"
    case .delete: "⌫"
    case .forwardDelete: "⌦"
    case .escape: "⎋"
    case .left: "←"
    case .right: "→"
    case .up: "↑"
    case .down: "↓"
    case .home: "↖"
    case .end: "↘"
    case .pageUp: "⇞"
    case .pageDown: "⇟"
    case .function(let number): "F\(number)"
    }
  }

  /// The key's name in the context file, which the model reads in English.
  public var englishName: String {
    switch self {
    case .character(let text): text
    case .space: "Space"
    case .returnKey: "Return"
    case .tab: "Tab"
    case .delete: "Delete"
    case .forwardDelete: "Forward Delete"
    case .escape: "Esc"
    case .left: "Left Arrow"
    case .right: "Right Arrow"
    case .up: "Up Arrow"
    case .down: "Down Arrow"
    case .home: "Home"
    case .end: "End"
    case .pageUp: "Page Up"
    case .pageDown: "Page Down"
    case .function(let number): "F\(number)"
    }
  }
}

/// One click inside the recorded region.
public struct RecordingClick: Equatable, Sendable {
  public enum Button: String, Sendable {
    case left, right, other
  }

  public var button: Button
  /// 1 for a single click, 2 for a double click, and so on.
  public var count: Int
  /// Where in the region, from 0 to 1 across and down from its top-left.
  public var location: CGPoint
  /// The Accessibility role of the element clicked (`AXButton`), when the app said.
  public var role: String?
  /// Its title (`AXTitle`, else `AXDescription`), when it has one.
  public var title: String?

  public init(
    button: Button, count: Int, location: CGPoint, role: String? = nil, title: String? = nil
  ) {
    self.button = button
    self.count = count
    self.location = location
    self.role = role
    self.title = title
  }
}

/// Something the user did while a take recorded. The input log stamps it on the host clock;
/// a ``RecordingTake`` holds it at media time (``RecordingTimeline/mediaTime(of:origin:)``).
public struct RecordingInputEvent: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case click(RecordingClick)
    /// A shortcut (⌘ or ⌃ held) or a key that does not type, such as Return or an arrow.
    case keys(RecordingModifiers, RecordingKey)
    /// The characters one key press typed. Nothing is logged while secure input is on.
    case text(String)
    /// Another app came to the front.
    case appSwitch(name: String, bundleID: String?)
    /// The app in front focused another of its windows.
    case windowSwitch(title: String)
  }

  public var time: Double
  public var kind: Kind

  public init(time: Double, kind: Kind) {
    self.time = time
    self.kind = kind
  }
}

/// A change of what the region shows, found by comparing frames (``ScreenChangeDetector``).
public struct RecordingScreenChange: Equatable, Sendable {
  /// When the screen began to change.
  public var time: Double
  /// When it was still again: the frame that shows the change.
  public var settled: Double
  /// The share of the region that changed, 0 to 1.
  public var fraction: Double

  public init(time: Double, settled: Double, fraction: Double) {
    self.time = time
    self.settled = settled
    self.fraction = fraction
  }
}
