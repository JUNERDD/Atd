import AICore
import Synchronization

/// What the recorder on the main actor and the writer on the sample queue share while a take
/// records: its pauses and stop, its origin, the microphone's switch and its level. The recorder
/// pauses, resumes, stops and switches the microphone synchronously, so each applies to the
/// samples stamped after it in the order the user pressed; the writer reads a copy per sample.
nonisolated final class RecordingWriterClock: Sendable {
  struct State: Sendable {
    var timeline = RecordingTimeline()
    /// The continuous host time of the first frame (media time zero); nil before it.
    var origin: Double?
    var isMicrophoneOn: Bool
    /// Counts the times the microphone was turned on: the writer starts a new microphone file
    /// whenever it changes.
    var microphoneTurns: Int
    /// Samples queued before the latest successful switch do not belong to its new file.
    var microphoneStartedAt = -Double.infinity
    var level = 0.0
    var levelAt = -Double.infinity
  }

  /// A level older than this is silence: the microphone stopped sending.
  static let levelLifetime = 0.3

  private let state: Mutex<State>

  init(microphoneOn: Bool) {
    state = Mutex(State(isMicrophoneOn: microphoneOn, microphoneTurns: microphoneOn ? 1 : 0))
  }

  /// A copy of the state now.
  var current: State { state.withLock { $0 } }

  func pause(at time: Double) { state.withLock { $0.timeline.pause(at: time) } }

  func resume(at time: Double) { state.withLock { $0.timeline.resume(at: time) } }

  /// Stops the take at host `time` (``RecordingTimeline/stop(at:)``): the writer drops what is
  /// captured from then on and the clock stands still there.
  func stop(at time: Double) { state.withLock { $0.timeline.stop(at: time) } }

  /// Turns the microphone's switch; turning it on starts a new stretch.
  func setMicrophone(on: Bool) {
    state.withLock { state in
      guard on != state.isMicrophoneOn else { return }
      state.isMicrophoneOn = on
      if on {
        state.microphoneTurns += 1
        state.microphoneStartedAt = RecordingSamples.hostNow
      } else {
        state.level = 0
      }
    }
  }

  /// Sets the origin once, at the first frame.
  func start(at origin: Double) {
    state.withLock { if $0.origin == nil { $0.origin = origin } }
  }

  func record(level: Double, at time: Double) {
    state.withLock {
      $0.level = level
      $0.levelAt = time
    }
  }

  /// The live state at host `now`.
  func live(at now: Double) -> RecordingLiveState {
    state.withLock {
      RecordingLiveState(
        elapsed: $0.timeline.elapsed(at: now, origin: $0.origin),
        isPaused: $0.timeline.isPaused,
        microphoneLevel: $0.timeline.stop == nil && $0.isMicrophoneOn
          && now - $0.levelAt < Self.levelLifetime ? $0.level : 0,
        isMicrophoneOn: $0.isMicrophoneOn)
    }
  }
}
