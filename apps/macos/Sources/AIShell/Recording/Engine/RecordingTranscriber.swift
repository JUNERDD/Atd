import AICore
import AVFoundation
import Speech

/// Narration from a take's microphone files, recognized on this Mac only (decision R11): no
/// audio leaves it. SpeechAnalyzer's transcriber does the work when available for the language
/// (`RecordingTranscriber+Analyzer.swift`); otherwise SFSpeechRecognizer requires on-device
/// recognition (`RecordingTranscriber+Recognizer.swift`). The capability is chosen here, so
/// callers never look at the system. Either hears the user's language in the closest locale it
/// supports (``RecordingSpeechLocale``).
/// Both need the Speech Recognition grant, which is asked the first time a take with microphone
/// audio is processed; without it the recording has no narration and says why.
nonisolated enum RecordingTranscriber {
  enum Failure: Error {
    /// No recognizer for the language runs on this Mac.
    case unavailable
    case failed
  }

  /// Words this far apart start a new line.
  static let lineGap = 0.9
  /// A line grows no longer than this many characters before a new one starts.
  static let lineLength = 160

  /// The language narration is heard in: the user's first preferred language.
  static var preferredLocale: Locale {
    Locale(identifier: Locale.preferredLanguages.first ?? "en-US")
  }

  /// The lines said in `segments` (the take's microphone files), at media time; a reason
  /// instead when there is no narration. The recognizer is made once; then each stretch is
  /// heard on its own, so one that fails loses only its own lines. Failure is reported only
  /// when no stretch could be heard; a successfully heard silent stretch is an empty result.
  static func transcribe(_ segments: [RecordingAudioSegment], locale: Locale) async
    -> RecordingNarration
  {
    guard !segments.isEmpty else { return .microphoneOff }
    guard await authorize() else { return .notAllowed }
    let listener: Listener
    do throws(Failure) {
      if #available(macOS 26, *), let supported = try? await analyzerLocale(for: locale) {
        listener = .analyzer(supported)
      } else {
        listener = .recognizer(try recognizer(for: locale))
      }
    } catch {
      return error == .unavailable ? .unavailable : .failed
    }
    var lines: [RecordingNarrationLine] = []
    var failed = 0
    for segment in segments {
      do throws(Failure) {
        lines += try await hear(segment.url, with: listener).map { line in
          RecordingNarrationLine(
            time: line.time + segment.start, end: line.end + segment.start, text: line.text)
        }
      } catch {
        failed += 1
      }
    }
    return failed == segments.count ? .failed : .transcribed(lines)
  }

  /// What hears a take's files, made once for all of them.
  private enum Listener {
    /// SpeechAnalyzer's transcriber in this locale, its model installed (macOS 26).
    case analyzer(Locale)
    case recognizer(SFSpeechRecognizer)
  }

  private static func hear(_ url: URL, with listener: Listener) async throws(Failure)
    -> [RecordingNarrationLine]
  {
    switch listener {
    case .recognizer(let recognizer):
      return try await recognize(url, with: recognizer)
    case .analyzer(let locale):
      // Only made where SpeechAnalyzer exists.
      guard #available(macOS 26, *) else { throw .unavailable }
      return try await analyze(url, locale: locale)
    }
  }

  /// Whether Atd may recognize speech, asking the first time.
  private static func authorize() async -> Bool {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: return true
    case .notDetermined:
      let status = await withCheckedContinuation { answer in
        SFSpeechRecognizer.requestAuthorization { answer.resume(returning: $0) }
      }
      return status == .authorized
    default: return false
    }
  }

  /// A run of recognized words, in seconds of its file.
  struct Phrase: Sendable {
    var start: Double
    var end: Double
    var text: String
  }

  /// The transcription's words grouped into lines: a pause of ``lineGap`` or a line of
  /// ``lineLength`` characters starts a new one. Each line's text is its stretch of the
  /// formatted transcription, so spacing and punctuation stay the recognizer's.
  static func phrases(_ transcription: SFTranscription) -> [Phrase] {
    let formatted = transcription.formattedString as NSString
    var phrases: [Phrase] = []
    var run: (start: Double, end: Double, from: Int, to: Int)?
    func close() {
      guard let current = run else { return }
      let text = formatted.substring(
        with: NSRange(location: current.from, length: current.to - current.from)
      )
      .trimmingCharacters(in: .whitespacesAndNewlines)
      if !text.isEmpty {
        phrases.append(Phrase(start: current.start, end: current.end, text: text))
      }
      run = nil
    }
    for segment in transcription.segments {
      let range = segment.substringRange
      if let current = run,
        segment.timestamp - current.end > lineGap || range.upperBound - current.from > lineLength
      {
        close()
      }
      let end = segment.timestamp + segment.duration
      run =
        run.map { ($0.start, end, $0.from, range.upperBound) }
        ?? (segment.timestamp, end, range.location, range.upperBound)
    }
    close()
    return phrases
  }
}
