/// The languages the native surfaces ship. The raw value is the `.lproj` the String Catalog
/// compiles to.
public enum ShellLanguage: String, CaseIterable, Sendable {
  case english = "en"
  case simplifiedChinese = "zh-Hans"

  /// The service's `language` setting (`APP_LANGUAGES`: `en`, `zh-CN`), pushed by the page.
  public init?(appLanguage: String) {
    switch appLanguage {
    case "en": self = .english
    case "zh-CN": self = .simplifiedChinese
    default: return nil
    }
  }

  /// Until the page pushes the setting: the renderer's `resolveLanguage` applied to the first
  /// preferred system language, so both sides start in the same language.
  public static func system(preferredLanguages: [String]) -> ShellLanguage {
    preferredLanguages.first?.lowercased().hasPrefix("zh") == true ? .simplifiedChinese : .english
  }
}
