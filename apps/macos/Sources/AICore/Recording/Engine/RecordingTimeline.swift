import Foundation

/// The pauses of one take on the host clock (seconds, `CMClockGetHostTimeClock`), and the
/// mapping that removes them (decision R5): what is captured inside a pause is left out, and
/// everything after it moves earlier by the pauses before it, so one file holds the take without
/// gaps. "Continuous" times are host times with the earlier pauses taken out; a take's own time
/// ("media time") is a continuous time less the take's origin, the continuous time of its first
/// frame. Once the take stops (``stop(at:)``), nothing captured from then on belongs to it.
public struct RecordingTimeline: Equatable, Sendable {
  /// One pause, open while `end` is nil.
  public struct Pause: Equatable, Sendable {
    public var start: Double
    public var end: Double?
  }

  /// Something captured this little before the origin still counts, at the origin.
  static let originTolerance = 0.25

  public private(set) var pauses: [Pause] = []
  /// The host time the take stopped at: the user's Stop, or the moment the capture stopped by
  /// itself. Nil while it records.
  public private(set) var stop: Double?

  public init() {}

  /// Whether a pause is open.
  public var isPaused: Bool { pauses.last.map { $0.end == nil } ?? false }

  /// Opens a pause at host `time`; nothing while one is open.
  public mutating func pause(at time: Double) {
    guard stop == nil, !isPaused else { return }
    pauses.append(Pause(start: time, end: nil))
  }

  /// Closes the open pause at host `time`, never before it began; nothing while none is open.
  public mutating func resume(at time: Double) {
    guard stop == nil, isPaused, let last = pauses.indices.last else { return }
    pauses[last].end = max(time, pauses[last].start)
  }

  /// Stops the take at host `time`; the earliest stop stands.
  public mutating func stop(at time: Double) {
    stop = min(stop ?? time, time)
  }

  /// Whether something captured at host `time` falls in a pause, open or closed.
  public func isPaused(at time: Double) -> Bool {
    pause(holding: time) != nil
  }

  /// Whether something captured at host `time` belongs to the take: outside every pause and
  /// before its stop.
  public func includes(_ time: Double) -> Bool {
    !isPaused(at: time) && stop.map { time < $0 } ?? true
  }

  /// Host `time` less the pauses that ended by then.
  public func continuous(_ time: Double) -> Double {
    time
      - pauses.reduce(0) { sum, pause in
        guard let end = pause.end, end <= time else { return sum }
        return sum + end - pause.start
      }
  }

  /// The seconds recorded by host `now` since `origin` (a continuous time), pauses left out: a
  /// pause holds the clock at its start, and the stop holds it for good. Zero before the first
  /// frame (`origin` nil).
  public func elapsed(at now: Double, origin: Double?) -> Double {
    guard let origin else { return 0 }
    let reference = min(now, stop ?? now)
    return max(0, continuous(pause(holding: reference)?.start ?? reference) - origin)
  }

  /// The media time of something that happened at host `time`; nil inside a pause, from the
  /// stop on, before the first frame, or more than ``originTolerance`` before the origin.
  public func mediaTime(of time: Double, origin: Double?) -> Double? {
    guard let origin, includes(time) else { return nil }
    let media = continuous(time) - origin
    return media >= -Self.originTolerance ? max(0, media) : nil
  }

  /// The pause, open or closed, that host `time` falls in.
  private func pause(holding time: Double) -> Pause? {
    pauses.first { time >= $0.start && $0.end.map { time < $0 } ?? true }
  }
}
