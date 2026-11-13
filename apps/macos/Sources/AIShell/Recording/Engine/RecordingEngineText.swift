import AICore
import Foundation

/// The engine's copy in the shell's language (``ShellStrings``): key badges, the steps as the
/// result card lists them, why a recording has no narration, and errors.
enum RecordingEngineText {
  static func text(_ key: RecordingEngineStringKey) -> String {
    ShellStrings.shared.text(key)
  }

  /// A catalog string with one `%@`.
  static func text(_ key: RecordingEngineStringKey, _ argument: String) -> String {
    String(format: text(key), locale: locale, argument)
  }

  /// A catalog string with one `%lld`.
  static func text(_ key: RecordingEngineStringKey, count: Int) -> String {
    String(format: text(key), locale: locale, count)
  }

  /// A key badge's label: the held modifiers' glyphs and the key cap, `⌘S`, `⇧A`, `Space`.
  static func keyLabel(_ modifiers: RecordingModifiers, _ key: RecordingKey) -> String {
    modifiers.symbols + (key.symbol ?? text(.keySpace))
  }

  /// One step as the result card lists it.
  static func describe(_ kind: RecordingStep.Kind) -> String {
    switch kind {
    case .click(let click):
      let title = click.title?.trimmingCharacters(in: .whitespacesAndNewlines)
      let (titled, plain): (RecordingEngineStringKey, RecordingEngineStringKey) =
        click.count > 1
        ? (.stepDoubleClick, .stepDoubleClickPlain)
        : click.button == .right
          ? (.stepRightClick, .stepRightClickPlain) : (.stepClick, .stepClickPlain)
      guard let title, !title.isEmpty else { return text(plain) }
      return text(titled, title)
    case .keys(let modifiers, let key): return text(.stepKeys, keyLabel(modifiers, key))
    case .typing(let typed): return text(.stepTyping, typed)
    case .appSwitch(let name): return text(.stepAppSwitch, name)
    case .windowSwitch(let title): return text(.stepWindowSwitch, title)
    case .screenChange: return text(.stepScreenChange)
    case .narration(let said): return text(.stepNarration, said)
    }
  }

  /// Why a recording has no narration, for the steps' header; nil when it was transcribed.
  static func narrationNote(_ narration: RecordingNarration) -> String? {
    switch narration {
    case .transcribed: nil
    case .microphoneOff: text(.narrationMicrophoneOff)
    case .notAllowed: text(.narrationNotAllowed)
    case .unavailable: text(.narrationUnavailable)
    case .failed: text(.narrationFailed)
    }
  }

  /// What a take's `issue` left out, for the result card (``RecordingTake/issues``).
  static func issueNote(_ issue: RecordingTake.Issue) -> String {
    switch issue {
    case .microphoneNotInMovie: text(.issueMicrophoneNotInMovie)
    }
  }

  static func message(_ error: RecordingError) -> String {
    text(error.messageKey)
  }

  private static var locale: Locale {
    Locale(identifier: ShellStrings.shared.language.rawValue)
  }
}
