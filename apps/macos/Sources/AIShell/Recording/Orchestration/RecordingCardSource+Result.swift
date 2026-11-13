import AICore
import Foundation

extension RecordingCardSource {
  /// The result card of a processed take: the engine's steps as the card lists them, worded in
  /// the shell language, and whether narration could be heard at all.
  init(_ result: RecordingResult, id: String, saveFolder: String?) {
    var notes = result.take.issues.map(RecordingEngineText.issueNote).sorted()
    if result.narration != .microphoneOff,
      let note = RecordingEngineText.narrationNote(result.narration)
    {
      notes.append(note)
    }
    self.init(
      id: id, movie: result.movie, duration: result.duration,
      pixelWidth: result.take.pixelWidth, pixelHeight: result.take.pixelHeight,
      pointSize: WindowSize(
        width: result.take.pointSize.width, height: result.take.pointSize.height),
      appName: result.app, steps: result.steps.map(RecordingCardStep.init),
      // The card's "No narration" says the microphone was off; a take that was heard but not
      // transcribed simply has no narration steps.
      narration: result.narration != .microphoneOff, saveFolder: saveFolder, notes: notes)
  }
}

extension RecordingCardStep {
  init(_ step: RecordingStep) {
    switch step.kind {
    // The card quotes narration itself.
    case .narration(let words):
      self.init(time: step.time, kind: .narration, text: words)
    case .click:
      self.init(time: step.time, kind: .click, text: RecordingEngineText.describe(step.kind))
    case .keys, .typing:
      self.init(time: step.time, kind: .key, text: RecordingEngineText.describe(step.kind))
    case .appSwitch, .windowSwitch:
      self.init(time: step.time, kind: .app, text: RecordingEngineText.describe(step.kind))
    case .screenChange:
      self.init(time: step.time, kind: .change, text: RecordingEngineText.describe(step.kind))
    }
  }
}

extension RecordingTrim {
  /// The kept range as the exporter takes it.
  var range: ClosedRange<Double> { start...end }
}
