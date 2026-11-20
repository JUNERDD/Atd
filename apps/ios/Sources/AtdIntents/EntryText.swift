import Foundation

/// Entry points' own copy that Atd itself shows or sends, from this module's `Entry` table: the
/// app's run sheet, Siri's snippets and 总结剪贴板's request. What the system shows for an intent
/// (titles, dialogs, failures) is in the main bundle's `EntryIntents` table instead.
public enum EntryText {
  public static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Entry", bundle: .module)
  }
}
