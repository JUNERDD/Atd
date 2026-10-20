import Foundation

/// Where one act or observe spent its time, for the single line the computer log gets when it
/// ends (``summary``). The coordinator times the resource claim; the engine adds the phases it
/// went through: listing surfaces, the driver's probe and prepare, the accessibility snapshot, the
/// capture, text recognition and the menu read, the typing guard, the driver's perform (as
/// ``Phase/keyScope`` when it opened a key scope), and the reads of a `wait` step and of the
/// postcondition, which count reads rather than entries. Only phase names, durations, counts and
/// outcome words go in, never anything read from the screen.
final class OperationPhases {
  enum Phase: String, CaseIterable {
    case claim, surfaces, probe, prepare, snapshot, capture, ocr, menu
    case typingGuard, keyScope, perform, wait, check
  }

  private let started = ContinuousClock.now
  private var spent: [Phase: (time: Duration, count: Int)] = [:]
  private var notes: [(key: String, value: String)] = []

  /// Adds the time since `start` to `phase`.
  func add(_ phase: Phase, since start: ContinuousClock.Instant, count: Int = 1) {
    let entry = spent[phase] ?? (.zero, 0)
    spent[phase] = (entry.time + (ContinuousClock.now - start), entry.count + count)
  }

  /// An outcome for the line, such as `pin` `covered`; a later note of the same key replaces it.
  func note(_ key: String, _ value: String) {
    notes.removeAll { $0.key == key }
    notes.append((key, value))
  }

  /// A stopwatch over back-to-back phases, each of which ends where the next begins.
  func laps() -> Laps { Laps(phases: self) }

  struct Laps {
    let phases: OperationPhases
    private var mark = ContinuousClock.now

    init(phases: OperationPhases) { self.phases = phases }

    /// Adds the time since the previous lap (or the start) to `phase`.
    mutating func end(_ phase: Phase) {
      phases.add(phase, since: mark)
      mark = .now
    }
  }

  /// `total=3.41s claim=0.00s probe=0.04s prepare=3.15s check=2.80s/12 pin=covered`: the time so
  /// far, then each phase that ran, in a fixed order, with its count after a slash when it is
  /// more than one, then the notes. Phases read concurrently (text recognition and the menu) can
  /// add up to more than the total.
  var summary: String {
    var parts = ["total=\(Self.seconds(ContinuousClock.now - started))"]
    for phase in Phase.allCases {
      guard let entry = spent[phase] else { continue }
      let count = entry.count > 1 ? "/\(entry.count)" : ""
      parts.append("\(phase.rawValue)=\(Self.seconds(entry.time))\(count)")
    }
    parts += notes.map { "\($0.key)=\($0.value)" }
    return parts.joined(separator: " ")
  }

  private static func seconds(_ duration: Duration) -> String {
    let (whole, fraction) = duration.components
    return String(format: "%.2fs", Double(whole) + Double(fraction) / 1e18)
  }
}
