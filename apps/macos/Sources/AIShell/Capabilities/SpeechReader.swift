import AVFoundation
import NaturalLanguage

/// `speech.speak` / `speech.stop`: reads text aloud, one utterance at a time. A new `speak`
/// replaces the one in progress. ``onChange`` reports whether the shell is speaking, on every
/// change only, for the `speech.state` event.
///
/// The state follows the current utterance alone: the synthesizer reports the end of a replaced
/// utterance after the next one was queued, and that late callback must not clear the new state.
@MainActor
final class SpeechReader: NSObject {
  /// Whether the shell is speaking; unchanged values are not reported again.
  var onChange: (Bool) -> Void = { _ in }
  private(set) var isSpeaking = false
  private let synthesizer = AVSpeechSynthesizer()
  private var current: AVSpeechUtterance?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  func speak(_ text: String) {
    current = nil
    synthesizer.stopSpeaking(at: .immediate)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = Self.voice(for: text)
    current = utterance
    setSpeaking(true)
    synthesizer.speak(utterance)
  }

  func stop() {
    current = nil
    synthesizer.stopSpeaking(at: .immediate)
    setSpeaking(false)
  }

  private func setSpeaking(_ speaking: Bool) {
    guard speaking != isSpeaking else { return }
    isSpeaking = speaking
    onChange(speaking)
  }

  /// The utterance ended or was cancelled; only the current one clears the state.
  private func finished(_ id: ObjectIdentifier) {
    guard let current, ObjectIdentifier(current) == id else { return }
    self.current = nil
    setSpeaking(false)
  }

  // MARK: Voice

  /// The best installed voice for the text's dominant language; nil leaves the system voice.
  static func voice(for text: String) -> AVSpeechSynthesisVoice? {
    guard let language = dominantLanguage(of: text) else { return nil }
    let wanted = Locale.Language(identifier: language.rawValue)
    let candidates = AVSpeechSynthesisVoice.speechVoices().filter {
      matches(Locale.Language(identifier: $0.language), wanted)
    }
    let preferred = Locale.preferredLanguages.first
    return candidates.max {
      rank($0, preferredLanguage: preferred) < rank($1, preferredLanguage: preferred)
    }
  }

  /// Recognition looks at the start of the text only; a long answer needs no more to settle.
  private static func dominantLanguage(of text: String) -> NLLanguage? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(String(text.prefix(2000)))
    return recognizer.dominantLanguage
  }

  /// Same language, and the same script where the recognized language names one (`zh-Hans`
  /// against a voice's `zh-CN`, which carries its script only once maximized).
  private static func matches(_ voice: Locale.Language, _ wanted: Locale.Language) -> Bool {
    guard voice.languageCode == wanted.languageCode else { return false }
    guard let script = wanted.script else { return true }
    return voice.maximalIdentifier.contains("-\(script.identifier)")
  }

  /// Higher is better: the quality tier first, then a voice for the user's own region.
  private static func rank(_ voice: AVSpeechSynthesisVoice, preferredLanguage: String?) -> Int {
    let quality =
      switch voice.quality {
      case .premium: 3
      case .enhanced: 2
      default: 1
      }
    return quality * 2 + (voice.language == preferredLanguage ? 1 : 0)
  }
}

extension SpeechReader: AVSpeechSynthesizerDelegate {
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor in self.finished(id) }
  }

  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
  ) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor in self.finished(id) }
  }
}
