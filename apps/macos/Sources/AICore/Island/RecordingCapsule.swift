/// The recording capsule's live values (architecture R7): what the island shows while the shell
/// records the screen. The orchestrator writes a new value as often as every 200 ms; the capsule
/// keeps one width between hour-digit changes (its timer reserves ``RecordingClock/reserved(for:)``,
/// its level meter keeps its room while the microphone is off) and swaps a control's glyph only when
/// ``face`` changes, so a click never lands on a control that is being replaced.
public struct RecordingCapsule: Equatable, Sendable {
  /// Seconds recorded so far, the paused time left out.
  public var elapsed: Double
  public var paused: Bool
  /// The microphone the recording takes now, by name; nil while it records none.
  public var microphone: String?
  /// The microphone the capsule's toggle turns on (the one used last); nil when none is known,
  /// which leaves the system's default input to the orchestrator.
  public var lastMicrophone: String?
  /// The microphone's level from 0 (silence) to 1; drawn only while it records and runs.
  public var level: Double

  public init(
    elapsed: Double = 0, paused: Bool = false, microphone: String? = nil,
    lastMicrophone: String? = nil, level: Double = 0
  ) {
    self.elapsed = elapsed
    self.paused = paused
    self.microphone = microphone
    self.lastMicrophone = lastMicrophone
    self.level = level
  }

  public var microphoneOn: Bool { microphone != nil }

  /// What the capsule's glyphs and status words show. The view keys its glyphs on this, so a
  /// tick that changes only the time or the level replaces nothing.
  public struct Face: Equatable, Sendable {
    public let paused: Bool
    public let microphoneOn: Bool
  }

  public var face: Face { Face(paused: paused, microphoneOn: microphoneOn) }

  /// The level meter's bars: their heights in points, each at least ``meterFloor``.
  /// While the microphone is off they lie flat at ``meterOff``, keeping their room; paused, they
  /// rest at the floor. The shares give the bars a speech-like contour from one level.
  public var meter: [Double] {
    guard microphoneOn else {
      return Array(repeating: Self.meterOff, count: Self.meterShares.count)
    }
    let level = paused ? 0 : min(max(level, 0), 1)
    return Self.meterShares.map { share in
      (Self.meterFloor + (Self.meterCeiling - Self.meterFloor) * level * share).rounded()
    }
  }

  /// The meter's height and the room it keeps, on or off.
  public static let meterHeight = 14.0
  public static let meterBarWidth = 2.0
  public static let meterGap = 2.0
  public static let meterFloor = 3.0
  public static let meterCeiling = meterHeight
  /// The flat line a bar draws while the microphone is off.
  public static let meterOff = 2.0
  private static let meterShares = [0.55, 1, 0.8, 0.45]
  /// The meter's width, the same on or off.
  public static var meterWidth: Double {
    let count = Double(meterShares.count)
    return count * meterBarWidth + (count - 1) * meterGap
  }
}

/// Times as the recording shows them, the same clock as the recording's context file the model
/// reads (`RecordingContext.timestamp`), so a time an answer quotes seeks the player: minutes
/// and seconds under an hour, "0:04", "12:30"; hours, minutes and seconds from an hour on,
/// "1:05:10".
public enum RecordingClock {
  /// The widest time under an hour, which the capsule's timer and the card's clocks keep room
  /// for (``reserved(for:)``).
  public static let reserved = "00:00"

  /// The room a clock that runs up to `seconds` keeps: ``reserved`` under an hour, then the
  /// width of `seconds` itself in zeros (digits are equally wide in the clocks' figures).
  public static func reserved(for seconds: Double) -> String {
    guard seconds >= 3600 else { return reserved }
    return String(text(seconds).map { $0 == ":" ? ":" : "0" })
  }

  /// `seconds` as `m:ss`, or `h:mm:ss` from an hour on, counting completed seconds (negative
  /// values show as 0:00).
  public static func text(_ seconds: Double) -> String {
    let whole = Int(max(seconds, 0).rounded(.down))
    let (hours, minutes, rest) = (whole / 3600, whole / 60 % 60, whole % 60)
    guard hours > 0 else { return "\(minutes):" + twoDigits(rest) }
    return "\(hours):" + twoDigits(minutes) + ":" + twoDigits(rest)
  }

  /// A range as the answer slot labels it: `0:02–0:12`.
  public static func range(_ trim: RecordingTrim) -> String {
    text(trim.start) + "–" + text(trim.end)
  }

  /// The seconds a time written `m:ss` or `h:mm:ss` names, or nil for text that is not one.
  /// Minutes before the first colon take one or two digits; hours grow with the recording.
  /// Each following component takes two digits and stays below 60.
  public static func seconds(_ text: Substring) -> Double? {
    let parts = text.split(separator: ":", omittingEmptySubsequences: false)
    guard (2...3).contains(parts.count), !parts[0].isEmpty,
      parts.count == 3 || (1...2).contains(parts[0].count),
      parts.dropFirst().allSatisfy({ $0.count == 2 }),
      parts.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } })
    else { return nil }
    let values = parts.compactMap { Int($0) }
    guard values.count == parts.count, values.dropFirst().allSatisfy({ $0 < 60 }) else {
      return nil
    }
    return values.reduce(0.0) { $0 * 60 + Double($1) }
  }

  private static func twoDigits(_ value: Int) -> String {
    (value < 10 ? "0" : "") + "\(value)"
  }
}
