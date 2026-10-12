import Testing

@testable import AICore

@Suite("Modifier double-tap")
struct ModifierDoubleTapTests {
  /// One modifier change: the modifiers down at `time`, with `inputs` key or mouse presses.
  private struct Change {
    var down: Set<TapModifier>
    var time: Double
    var inputs = 0
    var others = false
  }

  private static func run(_ changes: [Change]) -> [TapModifier?] {
    var detector = ModifierDoubleTap()
    return changes.map {
      detector.update(down: $0.down, others: $0.others, time: $0.time, inputs: $0.inputs)
    }
  }

  /// Two taps of `modifier`: presses at `first` and `second`, each up `hold` later.
  private static func taps(
    _ modifier: TapModifier, first: Double = 0, second: Double, hold: Double = 0.1
  ) -> [Change] {
    [
      Change(down: [modifier], time: first), Change(down: [], time: first + hold),
      Change(down: [modifier], time: second), Change(down: [], time: second + hold),
    ]
  }

  @Test("Two quick taps fire as the second comes up, not as it goes down")
  func firesOnSecondRelease() {
    #expect(Self.run(Self.taps(.command, second: 0.3)) == [nil, nil, nil, .command])
  }

  @Test("A second press after the interval starts a new first tap")
  func tooSlow() {
    let signals = Self.run(
      Self.taps(.option, second: 0.5) + [
        Change(down: [.option], time: 0.8), Change(down: [], time: 0.9),
      ])
    #expect(signals == [nil, nil, nil, nil, nil, .option])
  }

  @Test("A first press, or a second one, held too long is not a tap")
  func heldTooLong() {
    #expect(Self.run(Self.taps(.shift, second: 0.5, hold: 0.45)).allSatisfy { $0 == nil })
    let longSecond = Self.run([
      Change(down: [.shift], time: 0), Change(down: [], time: 0.1),
      Change(down: [.shift], time: 0.2), Change(down: [], time: 0.6),
    ])
    #expect(longSecond.allSatisfy { $0 == nil })
  }

  @Test("A tap followed by a shortcut with the same modifier never fires")
  func tapThenShortcut() {
    // ⌘ tapped, then ⌘C: C goes down while the second press is held.
    let signals = Self.run([
      Change(down: [.command], time: 0), Change(down: [], time: 0.1),
      Change(down: [.command], time: 0.2), Change(down: [], time: 0.3, inputs: 1),
    ])
    #expect(signals.allSatisfy { $0 == nil })
  }

  @Test("A key or mouse press between the taps cancels them")
  func otherInput() {
    let signals = Self.run([
      Change(down: [.command], time: 0), Change(down: [], time: 0.1, inputs: 1),
      Change(down: [.command], time: 0.2, inputs: 1), Change(down: [], time: 0.25, inputs: 1),
      Change(down: [.command], time: 0.3, inputs: 2), Change(down: [], time: 0.35, inputs: 2),
    ])
    #expect(signals.allSatisfy { $0 == nil })
  }

  @Test("Another modifier, Fn included, cancels the taps")
  func otherModifier() {
    let withShift = Self.run([
      Change(down: [.command], time: 0), Change(down: [], time: 0.1),
      Change(down: [.command], time: 0.2), Change(down: [.command, .shift], time: 0.25),
      Change(down: [], time: 0.3),
    ])
    #expect(withShift.allSatisfy { $0 == nil })
    let withFn = Self.run([
      Change(down: [.control], time: 0), Change(down: [], time: 0.1),
      Change(down: [.control], time: 0.2, others: true), Change(down: [], time: 0.25),
    ])
    #expect(withFn.allSatisfy { $0 == nil })
  }

  @Test("Tapping one modifier, then another, is no double-tap")
  func differentModifiers() {
    let signals = Self.run(
      [Change(down: [.command], time: 0), Change(down: [], time: 0.1)]
        + Self.taps(.option, first: 0.2, second: 0.3, hold: 0.05))
    #expect(signals == [nil, nil, nil, nil, nil, .option])
  }
}
