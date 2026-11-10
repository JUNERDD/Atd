import AICore
import AVFoundation
import CoreMedia
@_weakLinked import ScreenCaptureKit
import Synchronization

/// The sample side of one take (decision R5): ScreenCaptureKit's screen, system audio and
/// microphone samples become an H.264/AAC movie, with pauses cut out by moving later samples
/// earlier (``RecordingTimeline``, read from the shared ``RecordingWriterClock``).
///
/// The stream delivers every output on ``queue`` (``RecordingStreamOutput``), so samples arrive
/// in order; the writers and their bookkeeping (``RecordingWriterState``) sit behind one lock
/// that the recorder's finishing and cancelling take too. Video and system audio go to the
/// movie; the microphone goes to files of its own, one per stretch it is on
/// (``RecordingMicrophoneFiles``), which join the movie once it is finished (``RecordingMux``).
nonisolated final class RecordingWriter: Sendable {
  /// What a finished take wrote.
  struct Output: Sendable {
    /// Seconds recorded, pauses left out.
    let duration: Double
    /// The continuous host time of media time zero, for the input log.
    let origin: Double
    let timeline: RecordingTimeline
    let changes: [RecordingScreenChange]
    let microphone: [RecordingAudioSegment]
  }

  let queue = DispatchSerialQueue(label: "com.junerdd.ai.recording-writer", qos: .userInitiated)
  private let state: Mutex<RecordingWriterState>
  private let clock: RecordingWriterClock
  /// Told once, on the main actor, when writing fails mid-take: why, and the host time it
  /// failed at.
  private let onFailure: @MainActor @Sendable (String, Double) -> Void

  init(
    movie url: URL, folder: URL, plan: RecordingStreamPlan, systemAudio: Bool,
    clock: RecordingWriterClock,
    onFailure: @escaping @MainActor @Sendable (String, Double) -> Void
  ) throws(RecordingError) {
    state = Mutex(
      try RecordingWriterState(
        movie: url, folder: folder, plan: plan, systemAudio: systemAudio, clock: clock))
    self.clock = clock
    self.onFailure = onFailure
  }

  /// Takes one sample of the stream, on ``queue``.
  func append(_ sample: CMSampleBuffer, of type: SCStreamOutputType) {
    let delivered = RecordingSample(buffer: sample)
    let failure = state.withLock { state in
      state.append(delivered, of: type) { [weak self] number in
        self?.microphoneFileFinished(number)
      }
    }
    guard let failure else { return }
    let onFailure = onFailure
    let time = RecordingSamples.hostNow
    stop(at: time)
    Task { @MainActor in onFailure(failure, time) }
  }

  /// Freezes samples immediately, before an interruption reaches the main actor.
  func stop(at time: Double) { clock.stop(at: time) }

  /// Ends the take at host `stop` and finishes its files: the movie lasts until `stop` (until
  /// the open pause's start when paused, until the take's own stop when that came first), and
  /// every microphone file is done first.
  @concurrent
  func finish(at stop: Double) async throws(RecordingError) -> Output {
    state.withLock { state in
      state.close { [weak self] number in self?.microphoneFileFinished(number) }
    }
    await microphoneFilesFinished()
    try state.withLock { state throws(RecordingError) in try state.endMovie(at: stop) }
    await withCheckedContinuation { done in
      state.withLock { $0.finishMovie { done.resume() } }
    }
    return try state.withLock { state throws(RecordingError) in try state.output() }
  }

  /// Drops the take: nothing more is written and every file is abandoned to the folder.
  @concurrent
  func cancel() async {
    state.withLock { $0.cancel() }
    await microphoneFilesFinished()
  }

  private func microphoneFileFinished(_ number: Int) {
    let waiters = state.withLock { $0.microphoneFileFinished(number) }
    for waiter in waiters { waiter.resume() }
  }

  /// Returns once no microphone file is still being finished.
  private func microphoneFilesFinished() async {
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      let finished = state.withLock { state in
        guard !state.microphone.finishing.isEmpty else { return true }
        state.microphone.waiters.append(done)
        return false
      }
      if finished { done.resume() }
    }
  }
}
