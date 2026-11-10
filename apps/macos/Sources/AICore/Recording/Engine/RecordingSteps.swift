import Foundation

/// One thing the user said, from the microphone's transcription, at media time.
public struct RecordingNarrationLine: Equatable, Sendable {
  public var time: Double
  public var end: Double
  public var text: String

  public init(time: Double, end: Double, text: String) {
    self.time = time
    self.end = end
    self.text = text
  }
}

/// What a recording knows of what the user said. Every case but ``transcribed(_:)`` means
/// there is no narration, for the reason it names; the result card and the context file say so.
public enum RecordingNarration: Equatable, Sendable {
  /// The microphone was transcribed on this Mac; empty when nothing was said.
  case transcribed([RecordingNarrationLine])
  /// The microphone was off for the whole take.
  case microphoneOff
  /// Speech recognition is denied or restricted for Atd.
  case notAllowed
  /// No on-device recognizer for the language.
  case unavailable
  /// Recognition ran and failed.
  case failed

  public var lines: [RecordingNarrationLine] {
    if case .transcribed(let lines) = self { lines } else { [] }
  }
}

/// One step Atd reads from a recording (decision R9, R11): the result card lists them, the
/// filmstrip marks them, and the context file and key frames describe the trimmed ones.
public struct RecordingStep: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case click(RecordingClick)
    case keys(RecordingModifiers, RecordingKey)
    /// Characters typed in a row, coalesced (``RecordingSteps/typingGap``).
    case typing(String)
    case appSwitch(String)
    case windowSwitch(String)
    case screenChange
    case narration(String)
  }

  /// Media time the step began.
  public var time: Double
  /// When a step that lasts ended (typing, narration); ``time`` otherwise.
  public var end: Double
  /// The moment whose frame shows the step's outcome.
  public var frameTime: Double
  public var kind: Kind

  public init(time: Double, end: Double, frameTime: Double, kind: Kind) {
    self.time = time
    self.end = end
    self.frameTime = frameTime
    self.kind = kind
  }
}

/// Builds a take's ordered steps from its input log, screen changes and narration.
public enum RecordingSteps {
  /// Characters typed less than this many seconds apart, with nothing else in between, are one
  /// typing step.
  public static let typingGap = 2.0

  /// The steps in time order: clicks, shortcuts and keys, typing (characters coalesced, Delete
  /// taking back the last one typed), app and window switches, screen changes and narration.
  /// A step's frame is taken a moment after it (its outcome needs that long to draw), a screen
  /// change's once it settled; every frame time lies within `duration`.
  public static func make(
    events: [RecordingInputEvent], changes: [RecordingScreenChange],
    narration: [RecordingNarrationLine], duration: Double
  ) -> [RecordingStep] {
    var steps: [RecordingStep] = []
    var typing: (start: Double, last: Double, text: String)?
    func closeTyping() {
      if let run = typing, !run.text.isEmpty {
        steps.append(step(.typing(run.text), at: run.start, end: run.last, after: 0.3))
      }
      typing = nil
    }
    for event in events.sorted(by: { $0.time < $1.time }) {
      switch event.kind {
      case .text(let characters):
        if let run = typing, event.time - run.last <= typingGap {
          typing = (run.start, event.time, run.text + characters)
        } else {
          closeTyping()
          typing = (event.time, event.time, characters)
        }
      case .keys(let modifiers, .delete) where modifiers.isEmpty && typing != nil:
        if let run = typing, event.time - run.last <= typingGap {
          typing = (run.start, event.time, String(run.text.dropLast()))
        } else {
          closeTyping()
          steps.append(step(.keys(modifiers, .delete), at: event.time, after: 0.3))
        }
      case .keys(let modifiers, let key):
        closeTyping()
        steps.append(step(.keys(modifiers, key), at: event.time, after: 0.3))
      case .click(let click):
        closeTyping()
        steps.append(step(.click(click), at: event.time, after: 0.4))
      case .appSwitch(let name, _):
        closeTyping()
        steps.append(step(.appSwitch(name), at: event.time, after: 0.5))
      case .windowSwitch(let title):
        closeTyping()
        steps.append(step(.windowSwitch(title), at: event.time, after: 0.5))
      }
    }
    closeTyping()
    for change in changes {
      steps.append(
        RecordingStep(
          time: change.time, end: change.settled, frameTime: change.settled, kind: .screenChange))
    }
    for line in narration {
      steps.append(
        RecordingStep(
          time: line.time, end: line.end, frameTime: (line.time + line.end) / 2,
          kind: .narration(line.text)))
    }
    let upper = max(0, duration)
    return
      steps
      .map {
        var step = $0
        step.frameTime = min(max(0, step.frameTime), upper)
        return step
      }
      .enumerated()
      .sorted { ($0.element.time, $0.offset) < ($1.element.time, $1.offset) }
      .map(\.element)
  }

  /// The steps a trim keeps: those that begin within `range` (a little slack at both ends, so
  /// a step on a handle stays in).
  public static func kept(_ steps: [RecordingStep], in range: ClosedRange<Double>)
    -> [RecordingStep]
  {
    steps.filter { $0.time >= range.lowerBound - 0.05 && $0.time <= range.upperBound + 0.05 }
  }

  private static func step(
    _ kind: RecordingStep.Kind, at time: Double, end: Double? = nil, after delay: Double
  ) -> RecordingStep {
    let end = end ?? time
    return RecordingStep(time: time, end: end, frameTime: end + delay, kind: kind)
  }
}
