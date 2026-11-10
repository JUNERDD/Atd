import Foundation

/// A finished recording as its result card shows it (architecture R9): the movie, how long it
/// runs, its pixel size and source app for the title row, and the steps Atd reads from it. The
/// orchestrator maps the engine's processing result onto it; nothing here reads the engine.
public struct RecordingCardSource: Equatable, Sendable {
  /// Names the recording, so the card shown again for it keeps its trim and answers.
  public let id: String
  /// The recorded movie the player plays and the filmstrip's frames come from.
  public let movie: URL
  /// Seconds.
  public let duration: Double
  public let pixelWidth: Int
  public let pixelHeight: Int
  /// The captured region in screen points, before encoding downscales its pixels. The lightbox
  /// never shows the recording larger, whatever the output quality and the display's scale.
  public let pointSize: WindowSize
  /// The app the recording was made in, shown untranslated; nil when none is known.
  public let appName: String?
  /// What Atd reads, in time order (the card sorts them).
  public let steps: [RecordingCardStep]
  /// The microphone was on, so narration could be heard; false notes that there is none.
  public let narration: Bool
  /// The folder Save writes to, by name, for its tooltip; nil names none.
  public let saveFolder: String?
  /// Localized explanations of unavailable narration or recoverable recording issues.
  public let notes: [String]

  public init(
    id: String, movie: URL, duration: Double, pixelWidth: Int, pixelHeight: Int,
    pointSize: WindowSize,
    appName: String?, steps: [RecordingCardStep], narration: Bool, saveFolder: String? = nil,
    notes: [String] = []
  ) {
    self.id = id
    self.movie = movie
    self.duration = max(duration, 0.1)
    self.pixelWidth = max(pixelWidth, 1)
    self.pixelHeight = max(pixelHeight, 1)
    self.pointSize = pointSize
    self.appName = appName
    self.steps = steps.sorted { $0.time < $1.time }
    self.narration = narration
    self.saveFolder = saveFolder
    self.notes = notes
  }

  /// Width over height.
  public var aspect: Double { Double(pixelWidth) / Double(pixelHeight) }
}

/// One step Atd reads: a click, keys typed, an app or window switch, a change on screen or a
/// line of narration, at a time in the recording.
public struct RecordingCardStep: Equatable, Sendable {
  public enum Kind: String, CaseIterable, Sendable {
    case click, key, app, change, narration
  }

  /// Seconds into the recording.
  public let time: Double
  public let kind: Kind
  /// The step as the list reads it (a click's target, the keys, the narration's words), shown
  /// untranslated.
  public let text: String

  public init(time: Double, kind: Kind, text: String) {
    self.time = max(time, 0)
    self.kind = kind
    self.text = text
  }
}

/// The range of a recording that is kept: what plays, what Atd reads and what is saved,
/// copied or attached.
public struct RecordingTrim: Equatable, Sendable {
  public var start: Double
  public var end: Double

  public init(start: Double, end: Double) {
    self.start = start
    self.end = end
  }

  /// A step this close outside the range still counts as kept, as the playhead's tolerance.
  public static let slack = 0.05

  public var length: Double { end - start }

  public func keeps(_ time: Double) -> Bool {
    time >= start - Self.slack && time <= end + Self.slack
  }

  /// The two ends to the tenth of a second, the handles' finest nudge: two asks about ranges
  /// equal to it are about the same range.
  public var key: [Int] { [Int((start * 10).rounded()), Int((end * 10).rounded())] }

  public enum End: Sendable { case start, end }
}

/// The result card's own state, apart from playback and asking: the trim, which the card and its
/// lightbox share. It lives with the recording while the card is shown again and is replaced by
/// the next recording's; the answers asked about the recording (``RecordingAnswers``) live beside
/// it in the card's asking model, which persists with the card just as long (R10).
public struct RecordingCardState: Equatable, Sendable {
  public let source: RecordingCardSource
  public private(set) var trim: RecordingTrim

  public init(source: RecordingCardSource) {
    self.source = source
    trim = RecordingTrim(start: 0, end: source.duration)
  }

  /// The kept range is never shorter than this (or the whole recording, when shorter).
  public var shortest: Double { min(1, source.duration) }

  /// The handle nudges a press of an arrow key moves: a tenth of a second, a second with ⇧.
  public static func nudge(shift: Bool) -> Double { shift ? 1 : 0.1 }

  /// Moves one end of the kept range to `time`, within the recording and at least
  /// ``shortest`` from the other end; answers what it became.
  @discardableResult
  public mutating func setTrim(_ end: RecordingTrim.End, to time: Double) -> Double {
    switch end {
    case .start:
      trim.start = min(max(time, 0), trim.end - shortest)
      return trim.start
    case .end:
      trim.end = min(max(time, trim.start + shortest), source.duration)
      return trim.end
    }
  }

  /// Moves one end by `seconds` (an arrow key's nudge).
  @discardableResult
  public mutating func nudge(_ end: RecordingTrim.End, by seconds: Double) -> Double {
    setTrim(end, to: (end == .start ? trim.start : trim.end) + seconds)
  }

  /// The whole recording kept again ("还原").
  public mutating func resetTrim() {
    trim = RecordingTrim(start: 0, end: source.duration)
  }

  /// Either end moved off the recording's own.
  public var isTrimmed: Bool {
    trim.start > RecordingTrim.slack || trim.end < source.duration - RecordingTrim.slack
  }

  /// The step at index `index` is inside the kept range, so Atd reads it.
  public func keeps(step index: Int) -> Bool {
    source.steps.indices.contains(index) && trim.keeps(source.steps[index].time)
  }

  /// The step the playhead at `time` is on: the last kept one at or before it.
  public func step(at time: Double) -> Int? {
    source.steps.indices.last { index in
      source.steps[index].time <= time + RecordingTrim.slack && keeps(step: index)
    }
  }

  /// Where playing from `time` starts: there inside the kept range, else at its start.
  public func playStart(from time: Double) -> Double {
    time < trim.start || time >= trim.end - RecordingTrim.slack ? trim.start : time
  }

  /// `time` within the recording.
  public func clamped(_ time: Double) -> Double { min(max(time, 0), source.duration) }
}
