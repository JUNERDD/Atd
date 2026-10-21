import CoreGraphics
import Foundation

/// One piece of a foreground step's input (R4.5), in Quartz global points (y down). Every piece
/// goes to the target app as the background sends input, posted to its process and addressed to
/// the step's window; none moves the person's pointer or passes through the HID system (R13).
public enum ForegroundGesture: Equatable, Sendable {
  /// A left click; a `count` of 2 is a double click.
  case click(CGPoint, count: Int)
  /// A press at `from`, a move to `to` with the button held, and the release there, both inside
  /// the step's window.
  case drag(from: CGPoint, to: CGPoint)
  /// An element's accessibility focus (by the driver's element token), so the keys after it go
  /// there; when the app declines it, a click at `fallback`, where the element shows one.
  case focus(element: String, fallback: CGPoint?)
  /// One key with its modifiers, pressed and released.
  case chord(ComputerKeyName, [ComputerModifier])
  /// Text, sent in pieces (``ForegroundText``), each line break as a Return press.
  case text(String)

  /// Where the input lands: the points a hit test must find on the step's window. A focus's
  /// fallback point is tested only when the fallback is clicked.
  public var points: [CGPoint] {
    switch self {
    case .click(let point, _): [point]
    case .drag(let from, let to): [from, to]
    case .focus, .chord, .text: []
    }
  }

  /// Whether the gesture goes to the keyboard focus of the step's window.
  public var usesKeyboard: Bool {
    switch self {
    case .click, .drag, .focus: false
    case .chord, .text: true
    }
  }

  /// Whether the gesture can move the keyboard focus, so that keys after it wait for the app to
  /// take the change in: a click, a focus, a Return, and text that holds a line break.
  public var movesFocus: Bool {
    switch self {
    case .click, .focus: true
    case .drag: false
    case .chord(let key, _): key == .return
    case .text(let text): text.contains(where: \.isNewline)
    }
  }

  /// Whether an input method would take the keys for its own composition rather than pass them
  /// through as written: typed text, or a letter, digit or space without ⌘ or ⌃.
  public var composes: Bool {
    switch self {
    case .click, .drag, .focus: false
    case .text: true
    case .chord(let key, let modifiers):
      (key.isCharacter || key == .space) && modifiers.allSatisfy { $0 == .shift || $0 == .option }
    }
  }

  /// What the gesture does, for the step's evidence: never the text it types. Nil for a focus,
  /// which shows nothing of its own.
  public var summary: String? {
    switch self {
    case .click(_, let count): count == 2 ? "double-click" : "click"
    case .drag: "drag"
    case .focus: nil
    case .chord(let key, let modifiers):
      "press " + (modifiers.map(\.rawValue) + [key.rawValue]).joined(separator: "+")
    case .text(let text): "type \(text.count) character\(text.count == 1 ? "" : "s")"
    }
  }
}

/// Typed text as the foreground sends it (R4.5): runs of at most ``maxUnits`` UTF-16 units, never
/// splitting a character, with each line break (`\r\n`, `\n` or `\r`) as one Return press, as a
/// person types it. The step checks that the person is not typing and that the step's window
/// still has the keyboard before each piece.
public enum ForegroundText {
  public enum Piece: Equatable, Sendable {
    case characters(String)
    case newline
  }

  /// The most UTF-16 units one piece carries: what the driver posts as one key event
  /// (`KeyboardRecipes`), so each piece is a single event pair; a character longer than this goes
  /// alone.
  public static let maxUnits = 64

  public static func pieces(_ text: String) -> [Piece] {
    var pieces: [Piece] = []
    var run = ""
    var units = 0
    for character in text {
      if character.isNewline {
        if !run.isEmpty { pieces.append(.characters(run)) }
        (run, units) = ("", 0)
        pieces.append(.newline)
        continue
      }
      let count = character.utf16.count
      if !run.isEmpty, units + count > maxUnits {
        pieces.append(.characters(run))
        (run, units) = ("", 0)
      }
      run.append(character)
      units += count
    }
    if !run.isEmpty { pieces.append(.characters(run)) }
    return pieces
  }
}
