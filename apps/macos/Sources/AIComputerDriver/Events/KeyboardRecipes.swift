import CoreGraphics
import Foundation

/// Window-routed keyboard delivery, run inside a key scope the caller has already opened. Unicode
/// text is posted in bounded chunks via `keyboardSetUnicodeString`; a chord is posted as explicit
/// modifier-down, key down/up, modifier-up with the flags set on every event (never inherited
/// from the physical keyboard). Chords that are a command menu equivalent are routed by the host
/// to the AX menu item instead — a background cmd-chord never reaches the app's menu. Adapted from
/// open-computer-use `InputSimulation` (MIT).
enum KeyboardRecipes {
  private static let unicodeChunkLimit = 64

  /// Type `text` to `pid`. Returns false when an event could not be built.
  @discardableResult
  static func typeText(factory: EventFactory, text: String, pid: pid_t) -> Bool {
    for chunk in unicodeChunks(text) {
      guard let pair = factory.makeUnicode(chunk) else { return false }
      factory.post(pair.down, to: pid, dualPost: true)
      factory.post(pair.up, to: pid, dualPost: true)
      Thread.sleep(forTimeInterval: 0.01)
    }
    return true
  }

  /// Press a parsed chord on `pid`. Returns false when an event could not be built.
  @discardableResult
  static func pressChord(factory: EventFactory, chord: KeyMapping.Chord, pid: pid_t) -> Bool {
    guard let down = factory.makeKey(virtualKey: chord.keyCode, keyDown: true, flags: chord.flags),
      let up = factory.makeKey(virtualKey: chord.keyCode, keyDown: false, flags: chord.flags)
    else { return false }
    factory.post(down, to: pid, dualPost: true)
    factory.post(up, to: pid, dualPost: true)
    return true
  }

  /// Split `text` into chunks of at most `unicodeChunkLimit` UTF-16 units, never splitting a
  /// single character's units across chunks.
  static func unicodeChunks(_ text: String) -> [[UniChar]] {
    var chunks: [[UniChar]] = []
    var current: [UniChar] = []
    for character in text {
      let units = Array(String(character).utf16)
      if !current.isEmpty, current.count + units.count > unicodeChunkLimit {
        chunks.append(current)
        current.removeAll(keepingCapacity: true)
      }
      current.append(contentsOf: units)
    }
    if !current.isEmpty { chunks.append(current) }
    return chunks
  }
}
