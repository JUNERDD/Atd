import Foundation

/// The String Catalog in one language, as a lookup AICore can format with. AIShell passes the
/// app bundle's compiled table (`ShellStrings.catalog`); tests pass the catalog's source values.
public struct ShellText {
  public let language: ShellLanguage
  /// The catalog's string for a key's raw value.
  private let lookup: (String) -> String

  /// A table that knows the ``ShellStringKey`` strings only: any other key reads as its raw
  /// value, as a missing catalog entry does outside the app bundle.
  public init(language: ShellLanguage, lookup: @escaping (ShellStringKey) -> String) {
    self.language = language
    self.lookup = { raw in ShellStringKey(rawValue: raw).map(lookup) ?? raw }
  }

  /// A table that reads every key of the catalog by its raw value, whichever enum names it.
  public init(language: ShellLanguage, catalog: @escaping (String) -> String) {
    self.language = language
    lookup = catalog
  }

  /// The string for `key`, with its `%@`, `%1$@` or `%lld` placeholders filled in order.
  public func callAsFunction(_ key: ShellStringKey, _ arguments: any CVarArg...) -> String {
    format(lookup(key.rawValue), arguments)
  }

  /// The string for a key of a feature's own enum (``ShellCatalogKey``), filled the same way.
  public func callAsFunction(_ key: some ShellCatalogKey, _ arguments: any CVarArg...) -> String {
    format(lookup(key.rawValue), arguments)
  }

  private func format(_ format: String, _ arguments: [any CVarArg]) -> String {
    guard !arguments.isEmpty else { return format }
    return String(
      format: format, locale: Locale(identifier: language.rawValue), arguments: arguments)
  }
}
