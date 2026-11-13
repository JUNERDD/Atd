import AICore
import AVFoundation
import CoreMedia

/// The microphone's files of one take, kept behind ``RecordingWriter``'s lock. A file opens at
/// the first sample after the microphone is turned on and closes when it is turned off, so each
/// stretch is a file starting at its own media time; nothing is written while it is off, and a
/// take whose microphone stayed off has none.
nonisolated struct RecordingMicrophoneFiles {
  struct Open {
    let number: Int
    /// The ``RecordingWriterClock/State/microphoneTurns`` this file belongs to.
    let turn: Int
    let url: URL
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let start: CMTime
    var end: CMTime
  }

  private var open: Open?
  private var count = 0
  /// The turn whose file could not be made: no new attempt until the next turn.
  private var failedTurn: Int?
  /// Closed files still being finished, by number, and who waits for all of them.
  private(set) var finishing: [Int: Open] = [:]
  var waiters: [CheckedContinuation<Void, Never>] = []
  private(set) var done: [RecordingAudioSegment] = []

  /// Writes a sample into the current stretch's file, opening it at the first sample of a turn
  /// and closing the last turn's. `origin` is the movie's media time zero, nil before its first
  /// frame (nothing is written then).
  mutating func append(
    _ sample: CMSampleBuffer, state: RecordingWriterClock.State, origin: CMTime?, folder: URL,
    onFinished: @escaping @Sendable (Int) -> Void
  ) {
    guard state.isMicrophoneOn else { return closeOpen(onFinished: onFinished) }
    if let open, open.turn != state.microphoneTurns { closeOpen(onFinished: onFinished) }
    guard let origin, let sample = RecordingSamples.audio(sample, within: state.timeline) else {
      return
    }
    let time = sample.presentationTimeStamp
    guard time.seconds >= state.microphoneStartedAt else { return }
    let start = RecordingSamples.shifted(time, timeline: state.timeline)
    guard start >= origin else { return }
    if open == nil, failedTurn != state.microphoneTurns {
      open = Self.openFile(number: count + 1, turn: state.microphoneTurns, at: start, in: folder)
      count += 1
      if open == nil { failedTurn = state.microphoneTurns }
    }
    guard var file = open else { return }
    // Contiguous and in step across a pause, as the system audio is.
    guard file.input.isReadyForMoreMediaData,
      let placed = RecordingSamples.following(sample, at: start, after: file.end),
      file.input.append(placed.buffer)
    else { return }
    file.end = placed.start + placed.buffer.duration
    open = file
  }

  /// Closes the open file, clipped to the take's end when given; `onFinished` hears its number
  /// once it is written.
  mutating func closeOpen(before end: CMTime? = nil, onFinished: @escaping @Sendable (Int) -> Void)
  {
    guard var file = open else { return }
    open = nil
    if let end { file.end = max(file.start, min(file.end, end)) }
    finishing[file.number] = file
    file.input.markAsFinished()
    file.writer.endSession(atSourceTime: file.end)
    let number = file.number
    file.writer.finishWriting { onFinished(number) }
  }

  /// Abandons the open file; closed ones still finish.
  mutating func cancelOpen() {
    open?.writer.cancelWriting()
    open = nil
  }

  /// Files the finished file `number` (deleting it when it failed or is empty) and answers the
  /// waiters to resume once none is left finishing.
  mutating func finished(_ number: Int, origin: CMTime?) -> [CheckedContinuation<Void, Never>] {
    guard let file = finishing.removeValue(forKey: number) else { return [] }
    if file.writer.status == .completed, let origin, file.end > file.start {
      done.append(
        RecordingAudioSegment(
          url: file.url, start: (file.start - origin).seconds,
          duration: (file.end - file.start).seconds))
    } else {
      try? FileManager.default.removeItem(at: file.url)
    }
    guard finishing.isEmpty else { return [] }
    defer { waiters = [] }
    return waiters
  }

  private static func openFile(number: Int, turn: Int, at start: CMTime, in folder: URL) -> Open? {
    let url = folder.appending(path: "microphone-\(number).m4a")
    guard let writer = try? AVAssetWriter(outputURL: url, fileType: .m4a) else { return nil }
    let input = AVAssetWriterInput(
      mediaType: .audio, outputSettings: RecordingAudioSettings.aac(channels: 1))
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else { return nil }
    writer.add(input)
    guard writer.startWriting() else { return nil }
    writer.startSession(atSourceTime: start)
    return Open(
      number: number, turn: turn, url: url, writer: writer, input: input, start: start, end: start)
  }
}
