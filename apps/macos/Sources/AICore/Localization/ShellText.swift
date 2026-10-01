import Foundation

/// The String Catalog in one language, as a lookup AICore can format with. AIShell passes the
/// app bundle's compiled table (`ShellStrings.catalog`); tests pass the catalog's source values.
public struct ShellText {
  public let language: ShellLanguage
  private let lookup: (ShellStringKey) -> String

  public init(language: ShellLanguage, lookup: @escaping (ShellStringKey) -> String) {
    self.language = language
    self.lookup = lookup
  }

  /// The string for `key`, with its `%@`, `%1$@` or `%lld` placeholders filled in order.
  public func callAsFunction(_ key: ShellStringKey, _ arguments: any CVarArg...) -> String {
    let format = lookup(key)
    guard !arguments.isEmpty else { return format }
    return String(
      format: format, locale: Locale(identifier: language.rawValue), arguments: arguments)
  }
}
