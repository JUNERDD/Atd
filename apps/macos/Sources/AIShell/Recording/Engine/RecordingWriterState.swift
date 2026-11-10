import AICore
import AVFoundation
import CoreMedia
@_weakLinked import ScreenCaptureKit

/// Everything ``RecordingWriter`` keeps behind its lock: the movie's writer and inputs, where
/// each track has got to, the screen-change detector and the microphone's files.
nonisolated struct RecordingWriterState {
  let clock: RecordingWriterClock
  /// Where the microphone's files go.
  let folder: URL
  private let movie: AVAssetWriter
  private let video: AVAssetWriterInput
  private let systemAudio: AVAssetWriterInput?
  /// The first frame's shifted time: media time zero.
  private(set) var origin: CMTime?
  private var lastFrame: CMTime?
  private var audioEnd: CMTime?
  private var detector = ScreenChangeDetector()
  private var latest: (signature: ScreenChangeDetector.Signature, time: Double)?
  /// Only the newest unexamined surface is retained, never a queue of video frames.
  private var pendingFrame: (buffer: CVPixelBuffer, time: Double)?
  private var lastObserved = -Double.infinity
  private var changes: [RecordingScreenChange] = []
  private var failure: String?
  /// Set once the take is finishing or cancelled: later samples are dropped.
  private var isClosed = false
  var microphone = RecordingMicrophoneFiles()

  init(
    movie url: URL, folder: URL, plan: RecordingStreamPlan, systemAudio: Bool,
    clock: RecordingWriterClock
  ) throws(RecordingError) {
    do {
      movie = try AVAssetWriter(outputURL: url, fileType: .mp4)
    } catch {
      throw .writerFailed(error.localizedDescription)
    }
    video = AVAssetWriterInput(mediaType: .video, outputSettings: Self.videoSettings(plan))
    video.expectsMediaDataInRealTime = true
    guard movie.canAdd(video) else { throw .writerFailed("The video track was refused.") }
    movie.add(video)
    if systemAudio {
      let input = AVAssetWriterInput(
        mediaType: .audio, outputSettings: RecordingAudioSettings.aac(channels: 2))
      input.expectsMediaDataInRealTime = true
      guard movie.canAdd(input) else { throw .writerFailed("The audio track was refused.") }
      movie.add(input)
      self.systemAudio = input
    } else {
      self.systemAudio = nil
    }
    self.folder = folder
    self.clock = clock
  }

  /// Takes one sample; answers the failure it caused, once, for the recorder to hear.
  /// `onMicrophoneFinished` is told when a microphone file closed by it is done.
  mutating func append(
    _ delivered: RecordingSample, of type: SCStreamOutputType,
    onMicrophoneFinished: @escaping @Sendable (Int) -> Void
  ) -> String? {
    let sample = delivered.buffer
    guard !isClosed, failure == nil, sample.isValid else { return nil }
    let state = clock.current
    switch type {
    case .screen: appendFrame(sample, state: state)
    case .audio: appendSystemAudio(sample, state: state)
    case .microphone:
      let time = sample.presentationTimeStamp.seconds
      if state.isMicrophoneOn, time >= state.microphoneStartedAt, state.timeline.includes(time),
        let level = RecordingSamples.level(of: sample)
      {
        clock.record(level: level, at: RecordingSamples.hostNow)
      }
      microphone.append(
        sample, state: state, origin: origin, folder: folder, onFinished: onMicrophoneFinished)
    @unknown default: break
    }
    return failure
  }

  /// Stops taking samples and closes the open microphone file.
  mutating func close(onMicrophoneFinished: @escaping @Sendable (Int) -> Void) {
    isClosed = true
    let end = origin.map { origin in
      let timeline = clock.current.timeline
      let elapsed = timeline.elapsed(at: RecordingSamples.hostNow, origin: origin.seconds)
      return origin + CMTime(seconds: elapsed, preferredTimescale: origin.timescale)
    }
    microphone.closeOpen(before: end, onFinished: onMicrophoneFinished)
  }

  /// Ends the movie's session at host `stop` (the take's own stop when earlier), at least at its
  /// last frame; throws when nothing was recorded or writing failed, after cancelling it.
  mutating func endMovie(at stop: Double) throws(RecordingError) {
    guard let origin else {
      movie.cancelWriting()
      throw .writerFailed("No frame was recorded.")
    }
    if let failure {
      movie.cancelWriting()
      throw .writerFailed(failure)
    }
    let elapsed = clock.current.timeline.elapsed(at: stop, origin: origin.seconds)
    var end = origin + CMTime(seconds: elapsed, preferredTimescale: origin.timescale)
    if let lastFrame, end < lastFrame { end = lastFrame }
    // A final change inside the sampling interval still belongs to the take.
    if let pendingFrame { observe(at: pendingFrame.time, finishing: true) }
    if let latest, let change = detector.finish(lastTime: latest.time) { changes.append(change) }
    video.markAsFinished()
    systemAudio?.markAsFinished()
    movie.endSession(atSourceTime: end)
    lastFrame = end
  }

  func finishMovie(_ completion: @escaping @Sendable () -> Void) {
    movie.finishWriting(completionHandler: completion)
  }

  /// The finished take's output; throws when the movie did not complete.
  func output() throws(RecordingError) -> RecordingWriter.Output {
    guard movie.status == .completed, let origin, let lastFrame else {
      throw .writerFailed(movie.error?.localizedDescription ?? "The movie could not be finished.")
    }
    return RecordingWriter.Output(
      duration: (lastFrame - origin).seconds, origin: origin.seconds,
      timeline: clock.current.timeline, changes: changes,
      microphone: microphone.done.sorted { $0.start < $1.start })
  }

  mutating func cancel() {
    isClosed = true
    pendingFrame = nil
    if movie.status == .writing { movie.cancelWriting() }
    microphone.cancelOpen()
  }

  /// Files a finished microphone file and answers who waited for the last one.
  mutating func microphoneFileFinished(_ number: Int) -> [CheckedContinuation<Void, Never>] {
    microphone.finished(number, origin: origin)
  }

  private mutating func appendFrame(_ sample: CMSampleBuffer, state: RecordingWriterClock.State) {
    let time = sample.presentationTimeStamp
    guard time.isValid, state.timeline.includes(time.seconds) else { return }
    let start = RecordingSamples.shifted(time, timeline: state.timeline)
    switch RecordingSamples.status(of: sample) {
    case .complete:
      break
    case .idle:
      // Nothing new on screen: the last frame still stands, which lets a change settle.
      if let origin { observe(at: (start - origin).seconds) }
      return
    default: return
    }
    if origin == nil {
      guard movie.startWriting() else {
        failure = movie.error?.localizedDescription ?? "The movie could not start."
        return
      }
      movie.startSession(atSourceTime: start)
      origin = start
      clock.start(at: start.seconds)
    }
    guard let origin else { return }
    if let lastFrame, start <= lastFrame { return }
    guard video.isReadyForMoreMediaData, let copy = RecordingSamples.retimed(sample, to: start)
    else { return }
    guard video.append(copy) else {
      failure = movie.error?.localizedDescription ?? "A frame could not be written."
      return
    }
    lastFrame = start
    if let buffer = sample.imageBuffer {
      let media = (start - origin).seconds
      pendingFrame = (buffer, media)
      observe(at: media)
    }
  }

  /// Throttle before locking and reading pixels, not after computing every frame's signature.
  /// Idle samples consume the newest pending frame too, so a screen that changed then became
  /// still is not mistaken for the last sampled image. Stop flushes the last pending frame.
  private mutating func observe(at time: Double, finishing: Bool = false) {
    guard finishing || time - lastObserved >= ScreenChangeDetector.interval else { return }
    lastObserved = time
    if let pendingFrame {
      if let signature = RecordingSamples.signature(of: pendingFrame.buffer) {
        latest = (signature, pendingFrame.time)
      }
      self.pendingFrame = nil
    }
    guard let latest else { return }
    if let change = detector.observe(latest.signature, at: time) { changes.append(change) }
  }

  private mutating func appendSystemAudio(
    _ sample: CMSampleBuffer, state: RecordingWriterClock.State
  ) {
    guard let systemAudio, let origin,
      let sample = RecordingSamples.audio(sample, within: state.timeline)
    else { return }
    let time = sample.presentationTimeStamp
    let start = RecordingSamples.shifted(time, timeline: state.timeline)
    guard start >= origin, systemAudio.isReadyForMoreMediaData,
      let placed = RecordingSamples.following(sample, at: start, after: audioEnd)
    else { return }
    guard systemAudio.append(placed.buffer) else {
      failure = movie.error?.localizedDescription ?? "Audio could not be written."
      return
    }
    audioEnd = placed.start + placed.buffer.duration
  }

  /// H.264 at the plan's size and rate, tagged Rec. 709 (the stream delivers sRGB).
  private static func videoSettings(_ plan: RecordingStreamPlan) -> [String: Any] {
    [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: plan.pixelWidth,
      AVVideoHeightKey: plan.pixelHeight,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: plan.averageBitRate,
        AVVideoExpectedSourceFrameRateKey: plan.fps,
        AVVideoMaxKeyFrameIntervalKey: plan.fps * 2,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: false,
      ] as [String: Any],
      AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      ],
    ]
  }
}
