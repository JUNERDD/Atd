import Foundation

/// The context attachment of a recording (decision R11), the counterpart of a screenshot's
/// ``ScreenContext``: the model cannot watch the video, so this file tells it what the kept range
/// shows, step by step, and which key frame image belongs to which moment. Its labels stay English
/// whatever the app's language, because the file is data the model reads, not interface copy.
/// Times count from the start of the whole recording, as the result card's do, so a time an
/// answer quotes seeks the player to that moment.
public struct RecordingContext: Equatable, Sendable {
  /// Whether the movie travels with the context.
  public enum Video: Equatable, Sendable {
    /// Attached, under this file name.
    case attached(String)
    /// Left out: over the attachment limit even re-encoded.
    case tooLarge
    /// Not sent (asking sends only images and this file).
    case notSent
  }

  /// A key frame image and the moment it shows.
  public struct Keyframe: Equatable, Sendable {
    public var time: Double
    public var fileName: String

    public init(time: Double, fileName: String) {
      self.time = time
      self.fileName = fileName
    }
  }

  public var app: String?
  /// The range kept by the trim, in seconds of the recording.
  public var range: ClosedRange<Double>
  public var duration: Double
  public var pixelWidth: Int
  public var pixelHeight: Int
  public var narration: RecordingNarration
  /// The steps of ``range`` (``RecordingSteps/kept(_:in:)``).
  public var steps: [RecordingStep]
  public var keyframes: [Keyframe]
  public var video: Video

  public init(
    app: String?, range: ClosedRange<Double>, duration: Double, pixelWidth: Int,
    pixelHeight: Int, narration: RecordingNarration, steps: [RecordingStep],
    keyframes: [Keyframe], video: Video
  ) {
    self.app = app
    self.range = range
    self.duration = duration
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
    self.narration = narration
    self.steps = steps
    self.keyframes = keyframes
    self.video = video
  }

  /// The file's Markdown, at most ``ScreenContext/maxCharacters`` long: steps that do not fit
  /// are cut from the end and marked.
  public var markdown: String {
    var facts: [String] = []
    if let app = ScreenContext.inline(app) { facts.append("- App: \(app)") }
    let trimmed = range.lowerBound > 0.05 || range.upperBound < duration - 0.05
    facts.append(
      "- Recorded range: \(Self.timestamp(range.lowerBound))–\(Self.timestamp(range.upperBound))"
        + " of \(Self.timestamp(duration))" + (trimmed ? " (trimmed)" : ""))
    facts.append("- Size: \(pixelWidth) × \(pixelHeight) px")
    facts.append("- Narration: \(Self.narrationFact(narration))")
    facts.append("- Video: \(Self.videoFact(video))")
    var head = "# Screen recording context\n\n" + facts.joined(separator: "\n") + "\n"
    head +=
      "\nThe video itself is not read: the steps and key frames below describe it. Times count"
      + " from the start of the recording.\n"
    if !keyframes.isEmpty {
      head += "\n## Key frames\n\n"
      head +=
        keyframes.map { "- \(Self.timestamp($0.time)) \"\($0.fileName)\"" }
        .joined(separator: "\n") + "\n"
    }
    head += "\n## Steps\n\n"
    let lines = steps.map { "- \(Self.timestamp($0.time)) \(Self.describe($0.kind))" }
    return ScreenContext.capped(head: head, lines: lines.isEmpty ? ["- None detected"] : lines)
  }

  /// `m:ss`, or `h:mm:ss` from an hour on, rounded down to the second: the result card's clock.
  public static func timestamp(_ seconds: Double) -> String {
    RecordingClock.text(seconds)
  }

  /// One step, as the model reads it.
  static func describe(_ kind: RecordingStep.Kind) -> String {
    switch kind {
    case .click(let click):
      let what = [click.role, ScreenContext.inline(click.title).map { "\"\($0)\"" }]
        .compactMap(\.self).joined(separator: " ")
      let press =
        click.count > 1 ? "Double-click" : click.button == .right ? "Right-click" : "Click"
      let place =
        "at \(Int((click.location.x * 100).rounded()))% × \(Int((click.location.y * 100).rounded()))%"
      return what.isEmpty ? "\(press) \(place)" : "\(press) \(what) (\(place))"
    case .keys(let modifiers, let key):
      let names =
        [
          (RecordingModifiers.control, "Control"), (.option, "Option"), (.shift, "Shift"),
          (.command, "Command"),
        ]
        .filter { modifiers.contains($0.0) }.map(\.1) + [key.englishName]
      return "Press " + names.joined(separator: "+")
    case .typing(let text): return "Type \"\(ScreenContext.inline(text) ?? text)\""
    case .appSwitch(let name): return "Switch to app \"\(name)\""
    case .windowSwitch(let title): return "Switch to window \"\(title)\""
    case .screenChange: return "Screen changed"
    case .narration(let text): return "Said: \"\(ScreenContext.inline(text) ?? text)\""
    }
  }

  private static func narrationFact(_ narration: RecordingNarration) -> String {
    switch narration {
    case .transcribed(let lines):
      lines.isEmpty ? "none: nothing was said" : "transcribed from the microphone on this Mac"
    case .microphoneOff: "none: the microphone was off"
    case .notAllowed: "none: speech recognition is not allowed"
    case .unavailable: "none: no on-device speech recognition for the language"
    case .failed: "none: speech recognition failed"
    }
  }

  private static func videoFact(_ video: Video) -> String {
    switch video {
    case .attached(let name): "attached as \"\(name)\""
    case .tooLarge: "not attached: larger than the 64 MB attachment limit even re-encoded"
    case .notSent: "not sent"
    }
  }
}
