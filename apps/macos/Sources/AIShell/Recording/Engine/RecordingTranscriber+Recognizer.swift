import AICore
import Speech
import Synchronization

nonisolated extension RecordingTranscriber {
  /// SFSpeechRecognizer on device, in the closest locale it supports
  /// (``RecordingSpeechLocale``); never pass an unsupported language identifier through.
  static func recognizer(for locale: Locale) throws(Failure) -> SFSpeechRecognizer {
    guard
      let supported = RecordingSpeechLocale.match(
        locale, among: SFSpeechRecognizer.supportedLocales()),
      let recognizer = SFSpeechRecognizer(locale: supported),
      recognizer.isAvailable, recognizer.supportsOnDeviceRecognition
    else { throw .unavailable }
    return recognizer
  }

  /// What `recognizer` hears in the file at `url`, on device; no lines when nothing was said.
  nonisolated(nonsending) static func recognize(
    _ url: URL, with recognizer: SFSpeechRecognizer
  ) async throws(Failure)
    -> [RecordingNarrationLine]
  {
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.addsPunctuation = true
    var watch: RecognitionWatch?
    var task: SFSpeechRecognitionTask?
    let heard = await withCheckedContinuation {
      (answer: CheckedContinuation<RecognitionWatch.Outcome, Never>) in
      let delegate = RecognitionWatch(answer: answer)
      watch = delegate
      task = recognizer.recognitionTask(with: request, delegate: delegate)
    }
    // The task does not retain its delegate: all three stay alive until the answer is in.
    withExtendedLifetime((recognizer, task, watch)) {}
    switch heard {
    case .phrases(let phrases):
      return phrases.map { RecordingNarrationLine(time: $0.start, end: $0.end, text: $0.text) }
    case .silence: return []
    case .failure: throw .failed
    }
  }
}

/// Follows one recognition task to its one outcome. Apple's documented no-speech error is an
/// empty result; a recognition failure or a disconnected speech process is still a failure.
private nonisolated final class RecognitionWatch: NSObject, SFSpeechRecognitionTaskDelegate,
  Sendable
{
  enum Outcome: Sendable {
    case phrases([RecordingTranscriber.Phrase])
    case silence
    case failure
  }

  private struct State {
    var answer: CheckedContinuation<Outcome, Never>?
    var phrases: [RecordingTranscriber.Phrase]?
  }

  private let state: Mutex<State>

  init(answer: CheckedContinuation<Outcome, Never>) {
    state = Mutex(State(answer: answer))
  }

  func speechRecognitionTask(
    _ task: SFSpeechRecognitionTask,
    didFinishRecognition recognitionResult: SFSpeechRecognitionResult
  ) {
    let phrases = RecordingTranscriber.phrases(recognitionResult.bestTranscription)
    // The first final result is the transcription; an error after it does not undo it.
    state.withLock { state in
      if state.phrases == nil { state.phrases = phrases }
    }
  }

  func speechRecognitionTaskWasCancelled(_ task: SFSpeechRecognitionTask) {
    answer { _ in .failure }
  }

  func speechRecognitionTask(
    _ task: SFSpeechRecognitionTask, didFinishSuccessfully successfully: Bool
  ) {
    let error = task.error as NSError?
    // SFSpeechRecognitionTask.error documents this domain/code as no speech recognized.
    let noSpeech = error?.domain == "kAFAssistantErrorDomain" && error?.code == 1110
    answer { state in
      if let phrases = state.phrases { return .phrases(phrases) }
      return successfully || noSpeech ? .silence : .failure
    }
  }

  /// Resumes the recognition waiting for its outcome with the one `decide` picks, once.
  private func answer(_ decide: (State) -> Outcome) {
    let decided = state.withLock { state -> (CheckedContinuation<Outcome, Never>, Outcome)? in
      guard let answer = state.answer else { return nil }
      state.answer = nil
      return (answer, decide(state))
    }
    if case (let answer, let outcome)? = decided { answer.resume(returning: outcome) }
  }
}
