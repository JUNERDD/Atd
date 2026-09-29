import Foundation
import Testing

@testable import AICore

@Suite("Native localization")
struct ShellLocalizationTests {
  @Test("The pushed service language maps to a catalog language")
  func pushedLanguage() {
    #expect(ShellLanguage(appLanguage: "en") == .english)
    #expect(ShellLanguage(appLanguage: "zh-CN") == .simplifiedChinese)
    #expect(ShellLanguage(appLanguage: "fr") == nil)
  }

  @Test("Before the push, the first system language decides like the renderer")
  func systemLanguage() {
    #expect(ShellLanguage.system(preferredLanguages: ["zh-Hans-CN", "en"]) == .simplifiedChinese)
    #expect(ShellLanguage.system(preferredLanguages: ["zh-Hant-TW"]) == .simplifiedChinese)
    #expect(ShellLanguage.system(preferredLanguages: ["en-GB", "zh-Hans"]) == .english)
    #expect(ShellLanguage.system(preferredLanguages: []) == .english)
  }

  struct Catalog: Decodable {
    struct Entry: Decodable {
      let localizations: [String: Localization]
    }
    struct Localization: Decodable {
      struct Unit: Decodable {
        let state: String
        let value: String
      }
      let stringUnit: Unit
    }
    let sourceLanguage: String
    let strings: [String: Entry]
  }

  /// The catalog is compiled into the App target, so the test reads its source.
  static func catalog() throws -> Catalog {
    let url = URL(filePath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appending(path: "App/Localizable.xcstrings")
    return try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url))
  }

  @Test("Every key is in the catalog, translated into both languages")
  func catalogComplete() throws {
    let catalog = try Self.catalog()
    #expect(catalog.sourceLanguage == "en")
    #expect(Set(catalog.strings.keys) == Set(ShellStringKey.allCases.map(\.rawValue)))
    for (key, entry) in catalog.strings {
      for language in ShellLanguage.allCases {
        let unit = entry.localizations[language.rawValue]?.stringUnit
        #expect(unit?.state == "translated", "\(key) in \(language.rawValue)")
        #expect(unit?.value.isEmpty == false, "\(key) in \(language.rawValue)")
      }
    }
  }

  @Test("Format specifiers agree between languages")
  func formatSpecifiers() throws {
    let catalog = try Self.catalog()
    for (key, entry) in catalog.strings {
      for specifier in ["%lld", "%@"] {
        let counts = ShellLanguage.allCases.map { language in
          entry.localizations[language.rawValue]?.stringUnit.value.components(
            separatedBy: specifier
          ).count
        }
        #expect(Set(counts).count == 1, "\(key) \(specifier)")
      }
    }
  }
}
