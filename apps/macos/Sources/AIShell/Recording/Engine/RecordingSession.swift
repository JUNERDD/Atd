import AICore
import AppKit
import OSLog
@_weakLinked import ScreenCaptureKit

/// The capture of one take for ``ScreenRecorder``: the stream with its filter and settings, the
/// writer, and the take's folder in the temporary directory, which holds the raw capture, the
/// microphone's files and, once finished, the movie.
final class RecordingSession {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "recording")

  /// The region recorded, Quartz points, cut to the display.
  let region: CGRect
  let plan: RecordingStreamPlan
  let folder: URL
  private let config: RecordingConfig
  private let stream: SCStream
  /// Held for the stream's life: the stream does not retain its delegate.
  private let output: RecordingStreamOutput
  private let writer: RecordingWriter
  /// The writer's movie, before the microphone joins it and it takes its final name.
  private let capture: URL
  private var capturing = false
  /// A stream configuration change already sent; stopping waits for it before ending capture.
  private var microphoneUpdate: Task<RecordingError?, Never>?
  /// All callers share the same stop, including an interruption followed by Keep or Discard.
  private var captureStop: Task<Void, Never>?

  private init(
    region: CGRect, plan: RecordingStreamPlan, folder: URL, config: RecordingConfig,
    stream: SCStream, output: RecordingStreamOutput, writer: RecordingWriter, capture: URL
  ) {
    self.region = region
    self.plan = plan
    self.folder = folder
    self.config = config
    self.stream = stream
    self.output = output
    self.writer = writer
    self.capture = capture
  }

  /// Reads what can be captured, builds the filter, plan, writer and stream, without starting
  /// it. `prepare` puts windows the video must show on screen first and answers their numbers.
  static func open(
    config: RecordingConfig, microphoneID: String?, clock: RecordingWriterClock,
    prepare: (CGRect) -> Int?,
    onInterruption: @escaping @MainActor @Sendable (RecordingInterruption, Double) -> Void
  ) async throws(RecordingError) -> RecordingSession {
    let bounds = CGDisplayBounds(config.displayID)
    let cut = config.rect.standardized.intersection(CGRect(origin: .zero, size: bounds.size))
    guard bounds.width > 0, !cut.isNull, cut.width > 0, cut.height > 0 else {
      throw .displayUnavailable
    }
    let region = cut.offsetBy(dx: bounds.minX, dy: bounds.minY)
    let kept = prepare(region).map { Set([$0]) } ?? []
    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: true)
    } catch {
      throw Self.refusal(error)
    }
    guard let display = content.displays.first(where: { $0.displayID == config.displayID })
    else { throw .displayUnavailable }
    let filter = RecordingStreamSettings.filter(display: display, content: content, keeping: kept)
    guard
      let plan = RecordingStreamPlan.make(
        config, displaySize: bounds.size, scale: CGFloat(filter.pointPixelScale))
    else { throw .displayUnavailable }
    let folder = URL.temporaryDirectory.appending(path: "recording-\(UUID().uuidString)")
    let capture = folder.appending(path: "capture.mp4")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let writer = try RecordingWriter(
        movie: capture, folder: folder, plan: plan, systemAudio: config.systemAudio,
        clock: clock, onFailure: { onInterruption(.failed($0), $1) })
      let output = RecordingStreamOutput(writer: writer, onStop: onInterruption)
      let stream = SCStream(
        filter: filter,
        configuration: RecordingStreamSettings.configuration(
          plan, config, microphoneID: microphoneID),
        delegate: output)
      try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: writer.queue)
      if config.systemAudio {
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: writer.queue)
      }
      // Always added, so the microphone can be turned on while recording.
      try stream.addStreamOutput(output, type: .microphone, sampleHandlerQueue: writer.queue)
      return RecordingSession(
        region: plan.sourceRect.offsetBy(dx: bounds.minX, dy: bounds.minY), plan: plan,
        folder: folder, config: config, stream: stream, output: output, writer: writer,
        capture: capture)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      throw (error as? RecordingError) ?? .captureFailed(error.localizedDescription)
    }
  }

  func startCapture() async throws(RecordingError) {
    do {
      try await stream.startCapture()
    } catch {
      throw Self.refusal(error)
    }
    capturing = true
  }

  /// Switches the stream's microphone: `microphoneID`, or none.
  func update(microphoneID: String?) async throws(RecordingError) {
    guard capturing, microphoneUpdate == nil else { throw .notRecording }
    let update = Task<RecordingError?, Never> {
      do {
        try await stream.updateConfiguration(
          RecordingStreamSettings.configuration(plan, config, microphoneID: microphoneID))
        return nil
      } catch {
        return .captureFailed(error.localizedDescription)
      }
    }
    microphoneUpdate = update
    let failure = await update.value
    microphoneUpdate = nil
    if let failure { throw failure }
    guard capturing else { throw .notRecording }
  }

  func stopCapture() async {
    if let captureStop { return await captureStop.value }
    guard capturing else { return }
    capturing = false
    let update = microphoneUpdate
    let stop = Task<Void, Never> {
      _ = await update?.value
      try? await stream.stopCapture()
    }
    captureStop = stop
    await stop.value
  }

  /// Stops the stream and finishes the take at host `stop`: the movie with the microphone
  /// added under its final name, the input log's `events` at media time. Throws only when no
  /// movie was written: once it is, a later step that fails leaves that part out and the take
  /// says so (``RecordingTake/issues``). A movie the microphone could not join is kept without
  /// it (its files still serve narration); one that could not be renamed keeps its file's name.
  func finish(at stop: Double, events: [RecordingInputEvent], appName: String?)
    async throws(RecordingError) -> RecordingTake
  {
    await stopCapture()
    let output = try await writer.finish(at: stop)
    let startedAt = Date(timeIntervalSinceNow: output.origin - RecordingSamples.hostNow)
    var movie = capture
    var issues: Set<RecordingTake.Issue> = []
    if !output.microphone.isEmpty {
      if let combined = await combine(output.microphone) {
        movie = combined
      } else {
        issues.insert(.microphoneNotInMovie)
      }
    }
    movie = Self.rename(
      movie, to: folder.appending(path: RecordingFileNames.movie(startedAt: startedAt)))
    let media = events.compactMap { event -> RecordingInputEvent? in
      guard let time = output.timeline.mediaTime(of: event.time, origin: output.origin),
        time <= output.duration
      else { return nil }
      return RecordingInputEvent(time: time, kind: event.kind)
    }
    return RecordingTake(
      folder: folder, movie: movie, duration: output.duration, pixelWidth: plan.pixelWidth,
      pixelHeight: plan.pixelHeight, pointSize: plan.sourceRect.size, startedAt: startedAt,
      events: media, screenChanges: output.changes, microphone: output.microphone,
      appName: appName, issues: issues)
  }

  /// The capture with `microphone` added, in a file of its own; nil, with the capture left as
  /// it is, when they could not be combined.
  private func combine(_ microphone: [RecordingAudioSegment]) async -> URL? {
    let combined = folder.appending(path: "combined.mp4")
    do throws(RecordingError) {
      try await RecordingMux.combine(movie: capture, microphone: microphone, into: combined)
    } catch {
      Self.log.error(
        "The microphone could not join the movie: \(String(describing: error), privacy: .public)")
      try? FileManager.default.removeItem(at: combined)
      return nil
    }
    // Only a copy now; one left behind goes with the folder.
    try? FileManager.default.removeItem(at: capture)
    return combined
  }

  /// `file` moved to `final`; `file` itself, kept where it is, when it cannot be moved.
  private static func rename(_ file: URL, to final: URL) -> URL {
    do {
      try FileManager.default.moveItem(at: file, to: final)
      return final
    } catch {
      log.error("The movie keeps its working name: \(error.localizedDescription, privacy: .public)")
      return file
    }
  }

  /// Stops everything and deletes the take's folder.
  func cancel() async {
    await stopCapture()
    await writer.cancel()
    try? FileManager.default.removeItem(at: folder)
  }

  private static func refusal(_ error: any Error) -> RecordingError {
    DisplayFreezer.isPermissionError(error)
      ? .screenRecordingDenied : .captureFailed(error.localizedDescription)
  }
}
