import Foundation

/// Recognizes a double-tap shortcut (`DoubleTap+Command`) from modifier changes: one modifier
/// pressed and released on its own twice, the second press starting within ``interval`` of the
/// first and lasting at most ``secondTapLimit``. It completes as the second tap comes up, so the
/// modifier used for anything right after a tap (⌘ tapped, then ⌘C) never fires: a tap counts
/// only while no other modifier is down and no key or mouse button went down since the first
/// press. Either side's key counts as the modifier. A double-tap has no hold; the shell reports
/// it as a press and an immediate release (`ModifierTapMonitor` in AIShell).
///
/// It reads the same facts as the selection toolbar's ``ModifierDoublePress``; the page's
/// recorder (`modifier-double-tap.ts`) applies the same timing, so what records is what fires.
public struct ModifierDoubleTap: Sendable {
  /// Longest time, in seconds, from the first press to the second press.
  public static let interval: TimeInterval = 0.4
  /// Longest time, in seconds, the second press may stay down and still be a tap.
  public static let secondTapLimit: TimeInterval = 0.35

  private enum Phase: Sendable {
    case idle
    /// The modifier went down on its own at `time`, with `inputs` presses counted then.
    case down(TapModifier, time: TimeInterval, inputs: Int)
    /// That press came up in time; it is the first tap.
    case tapped(TapModifier, time: TimeInterval, inputs: Int)
    /// The second press went down in time at `time`.
    case second(TapModifier, time: TimeInterval, inputs: Int)
  }

  private var phase = Phase.idle

  public init() {}

  /// Feeds one modifier change and answers the modifier whose double-tap it completes. `down`:
  /// which of the four modifiers are down now; `others`: a modifier outside them (Fn) is down;
  /// `time`: the event's timestamp in seconds; `inputs`: a running count of key and mouse button
  /// presses, so a press of anything else between two changes shows.
  public mutating func update(
    down: Set<TapModifier>, others: Bool, time: TimeInterval, inputs: Int
  ) -> TapModifier? {
    guard !others, down.count <= 1 else {
      phase = .idle
      return nil
    }
    if let modifier = down.first {
      switch phase {
      case .tapped(modifier, let start, inputs) where time - start <= Self.interval:
        phase = .second(modifier, time: time, inputs: inputs)
      case .down(modifier, _, _), .second(modifier, _, _):
        break
      default:
        phase = .down(modifier, time: time, inputs: inputs)
      }
      return nil
    }
    switch phase {
    case .down(let modifier, let start, inputs) where time - start <= Self.interval:
      phase = .tapped(modifier, time: start, inputs: inputs)
      return nil
    case .second(let modifier, let start, inputs) where time - start <= Self.secondTapLimit:
      phase = .idle
      return modifier
    case .tapped:
      return nil
    default:
      phase = .idle
      return nil
    }
  }

  /// Forgets any tap in progress, as when the watched set changes or watching stops.
  public mutating func reset() {
    phase = .idle
  }
}
