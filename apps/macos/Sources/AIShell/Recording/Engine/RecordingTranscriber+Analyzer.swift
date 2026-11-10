import AICore
import AVFoundation
import Speech

@available(macOS 26, *)
nonisolated extension RecordingTranscriber {
  /// The locale SpeechAnalyzer's transcriber hears `locale` in: the closest one it supports
  /// (``RecordingSpeechLocale``), else the system's own equivalent. Its model is installed
  /// first when the system does not have it yet (a shared download the system manages).
  static func analyzerLocale(for locale: Locale) async throws(Failure) -> Locale {
    guard SpeechTranscriber.isAvailable else { throw .unavailable }
    var supported = RecordingSpeechLocale.match(
      locale, among: await SpeechTranscriber.supportedLocales)
    if supported == nil {
      supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
    }
    guard let supported else { throw .unavailable }
    let transcriber = SpeechTranscriber(locale: supported, preset: .transcription)
    do {
      if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
      {
        try await install.downloadAndInstall()
      }
    } catch {
      throw .unavailable
    }
    return supported
  }

  /// SpeechAnalyzer's transcriber over one file, on device, in `locale` (one
  /// ``analyzerLocale(for:)`` answered): each finished result is one line, at its audio range in
  /// the file; no lines when nothing was said.
  static func analyze(_ url: URL, locale: Locale) async throws(Failure)
    -> [RecordingNarrationLine]
  {
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    do {
      let file = try AVAudioFile(forReading: url)
      let analyzer = SpeechAnalyzer(modules: [transcriber])
      async let lines = finalLines(of: transcriber)
      if let end = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: end)
      } else {
        await analyzer.cancelAndFinishNow()
      }
      return try await lines
    } catch {
      throw .failed
    }
  }

  /// Every final result of `transcriber` until its analyzer finishes, as lines.
  private static func finalLines(of transcriber: SpeechTranscriber) async throws
    -> [RecordingNarrationLine]
  {
    var lines: [RecordingNarrationLine] = []
    for try await result in transcriber.results where result.isFinal {
      let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { continue }
      lines.append(
        RecordingNarrationLine(
          time: result.range.start.seconds, end: result.range.end.seconds, text: text))
    }
    return lines
  }
}
