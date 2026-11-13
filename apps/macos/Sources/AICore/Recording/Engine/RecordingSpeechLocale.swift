import Foundation

/// Which of a recognizer's locales hears narration spoken in the user's language (decision R11).
/// Recognizers list their own identifiers (`zh-CN`, `en_US`), while the user's language is often
/// written another way (`zh-Hans-CN`, a bare `en`), and a recognizer may not take it as given.
public enum RecordingSpeechLocale {
  /// The locale of `supported` with `preferred`'s language and script (the script a region
  /// implies counts: `zh-CN` is Simplified Chinese), in the first region of: `preferred`'s own,
  /// `region` (the user's), the language's usual one; else the first of the others by
  /// identifier. Nil when none speaks the language in that script: another language or script
  /// would transcribe the narration wrongly.
  public static func match(
    _ preferred: Locale, among supported: some Sequence<Locale>,
    region: Locale.Region? = Locale.current.region
  ) -> Locale? {
    let wanted = Locale.Language(identifier: preferred.language.maximalIdentifier)
    guard let code = wanted.languageCode else { return nil }
    let candidates = supported.filter { locale in
      let language = Locale.Language(identifier: locale.language.maximalIdentifier)
      return language.languageCode == code && language.script == wanted.script
    }
    .sorted { $0.identifier < $1.identifier }
    for choice in [preferred.language.region, region, wanted.region].compactMap(\.self) {
      if let hit = candidates.first(where: { $0.language.region == choice }) { return hit }
    }
    return candidates.first
  }
}
