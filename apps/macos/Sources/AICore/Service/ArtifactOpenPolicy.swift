import Foundation

/// Whether the shell may open a downloaded artifact without asking. The page can upload any
/// bytes under any name and then ask the shell to open them, so only document types open
/// directly; anything that could run code, and anything unknown, asks the user first.
///
/// The decision takes the file's Uniform Type Identifier and everything it conforms to (the
/// shell passes `UTType.identifier` and `UTType.supertypes` of the downloaded file's content
/// type), so it follows the system's type tree instead of matching extensions.
public enum ArtifactOpenPolicy {
  public enum Decision: Equatable, Sendable {
    /// A document: opening shows content in a viewer or editor.
    case openDirectly
    /// Could run code, or is not a known document type: the user confirms first.
    case askFirst
  }

  /// Types that run code, install software, mount or unpack further files, or open other
  /// locations when opened. Any match asks, even when the type is also a document (a
  /// macro-enabled Office file conforms to `public.executable`, an SVG to `public.image`).
  static let codeTypes: Set<String> = [
    "public.executable",
    "public.script",
    "public.shell-script",
    "com.apple.application",
    "com.apple.application-bundle",
    "public.archive",
    "public.disk-image",
    "com.apple.installer-package-archive",
    "com.apple.package",
    "com.apple.bundle",
    // .webloc, .inetloc, .fileloc and Windows .url shortcuts open the location they store.
    "public.stored-url",
    "com.apple.internet-location",
    // Aliases and symbolic links open whatever they point to.
    "com.apple.resolvable",
    "public.symlink",
    // Opens in a browser, where its scripts run with a file:// origin.
    "public.svg-image",
  ]

  /// Document types that open directly. Plain text includes Markdown and CSV; JSON and RTF
  /// conform only to `public.text`, which also covers HTML and XML, so they are listed alone.
  static let documentTypes: Set<String> = [
    "com.adobe.pdf",
    "public.image",
    "public.audiovisual-content",
    "public.plain-text",
    "public.json",
    "public.rtf",
    "org.openxmlformats.openxml",
    "com.microsoft.word.doc",
    "com.microsoft.excel.xls",
    "com.microsoft.powerpoint.ppt",
    "org.oasis-open.opendocument",
    "com.apple.iwork.pages.sffpages",
    "com.apple.iwork.numbers.sffnumbers",
    "com.apple.iwork.keynote.sffkey",
  ]

  /// `typeIdentifier` is nil when the system could not type the file. Identifiers compare
  /// case-insensitively, as Uniform Type Identifiers do.
  public static func decision(
    typeIdentifier: String?, conformsTo supertypes: some Sequence<String>
  ) -> Decision {
    guard let typeIdentifier else { return .askFirst }
    let types = Set(([typeIdentifier] + supertypes).map { $0.lowercased() })
    guard types.isDisjoint(with: codeTypes), !types.isDisjoint(with: documentTypes) else {
      return .askFirst
    }
    return .openDirectly
  }

  /// The file name as the confirmation shows it: invisible formatting characters (such as a
  /// right-to-left override that makes `evil.command` read as `dnammoc.pdf`, or zero-width
  /// spaces) are removed so the name cannot disguise its extension.
  public static func displayName(_ name: String) -> String {
    String(
      String.UnicodeScalarView(
        name.unicodeScalars.filter { $0.properties.generalCategory != .format }))
  }
}
