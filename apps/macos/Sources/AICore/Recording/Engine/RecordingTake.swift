import Foundation

/// What the recorder reports while it records, at most every 200 ms.
public struct RecordingLiveState: Equatable, Sendable {
  /// Seconds recorded so far, pauses left out.
  public var elapsed: Double
  public var isPaused: Bool
  /// The microphone's level, 0 (silent or off) to 1 (loud).
  public var microphoneLevel: Double
  public var isMicrophoneOn: Bool

  public init(elapsed: Double, isPaused: Bool, microphoneLevel: Double, isMicrophoneOn: Bool) {
    self.elapsed = elapsed
    self.isPaused = isPaused
    self.microphoneLevel = microphoneLevel
    self.isMicrophoneOn = isMicrophoneOn
  }
}

/// Why a take stopped recording without being asked to. The capture is already stopped; the
/// owner calls ``stop`` to keep what was recorded, or discards it.
public enum RecordingInterruption: Equatable, Sendable {
  /// The user stopped it from the system's screen-sharing menu.
  case stoppedBySystem
  /// The recorded display went away.
  case displayRemoved
  /// ScreenCaptureKit or the movie writer failed; the message is for logs.
  case failed(String)
}

/// A stretch of microphone audio in its own file, at its media time in the take. The microphone
/// is written apart from the movie so it can start and stop at any moment; ``RecordingTake``
/// keeps the files for transcription after their audio was added to the movie.
public struct RecordingAudioSegment: Equatable, Sendable {
  public var url: URL
  /// Where the file's first sample sits in the take, in seconds.
  public var start: Double
  public var duration: Double

  public init(url: URL, start: Double, duration: Double) {
    self.url = url
    self.start = start
    self.duration = duration
  }
}

/// A finished take. Every file lives in ``folder``, which belongs to whoever holds the take
/// (and the ``RecordingResult`` made from it): they delete it once the recording is no longer
/// shown or reopenable.
public struct RecordingTake: Equatable, Sendable {
  /// A part of the take that could not be finished as planned. The movie was written: a take
  /// with an issue is still the recording, with that part missing.
  public enum Issue: Hashable, Sendable {
    /// The microphone's audio could not be added to the movie; its files still give the
    /// narration.
    case microphoneNotInMovie
  }

  public var folder: URL
  /// The H.264/AAC movie: video, the system audio when recorded, the microphone when used.
  public var movie: URL
  /// Seconds, pauses left out.
  public var duration: Double
  /// The movie's pixels.
  public var pixelWidth: Int
  public var pixelHeight: Int
  /// The recorded region's size in points: a player never shows it larger.
  public var pointSize: CGSize
  /// When recording began (the first frame).
  public var startedAt: Date
  /// Clicks, keys and switches at media time, in order.
  public var events: [RecordingInputEvent]
  public var screenChanges: [RecordingScreenChange]
  /// The microphone's audio for narration, in order; empty when the microphone was never on.
  public var microphone: [RecordingAudioSegment]
  /// The app the take is about, for the result's title.
  public var appName: String?
  /// What could not be finished as planned; empty for a whole take.
  public var issues: Set<Issue>

  public init(
    folder: URL, movie: URL, duration: Double, pixelWidth: Int, pixelHeight: Int,
    pointSize: CGSize, startedAt: Date, events: [RecordingInputEvent],
    screenChanges: [RecordingScreenChange], microphone: [RecordingAudioSegment],
    appName: String?, issues: Set<Issue> = []
  ) {
    self.folder = folder
    self.movie = movie
    self.duration = duration
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
    self.pointSize = pointSize
    self.startedAt = startedAt
    self.events = events
    self.screenChanges = screenChanges
    self.microphone = microphone
    self.appName = appName
    self.issues = issues
  }

  /// Whether the microphone recorded anything.
  public var hasMicrophoneAudio: Bool { !microphone.isEmpty }

  /// The name the movie is saved, copied and attached under (``RecordingFileNames/movie``),
  /// whatever ``movie``'s own file is called.
  public var movieName: String { RecordingFileNames.movie(startedAt: startedAt) }
}

/// Why the engine could not record, process or export. Each case has its message in the String
/// Catalog (``messageKey``); `detail` texts are for logs.
public enum RecordingError: Error, Equatable, Sendable {
  /// The user denied Atd the microphone, or a policy restricts it.
  case microphoneDenied
  /// Screen Recording is not granted to this build.
  case screenRecordingDenied
  /// The display is gone or the region misses it.
  case displayUnavailable
  /// ScreenCaptureKit refused or failed.
  case captureFailed(String)
  /// The movie could not be written or finished.
  case writerFailed(String)
  /// Asked of a recorder in the wrong state (stopped twice, paused before it started).
  case notRecording
  /// A trimmed or re-encoded movie, a key frame or the context could not be written.
  case exportFailed(String)
  /// The folder could not be written (no access, full disk).
  case saveFailed(String)

  public var messageKey: RecordingEngineStringKey {
    switch self {
    case .microphoneDenied: .errorMicrophone
    case .screenRecordingDenied: .errorScreenRecording
    case .displayUnavailable: .errorDisplay
    case .captureFailed, .writerFailed, .notRecording: .errorRecording
    case .exportFailed: .errorExport
    case .saveFailed: .errorSave
    }
  }
}
