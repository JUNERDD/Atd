import Foundation

/// The copy of Atd's entry widgets, Lock Screen accessories and Live Activities, from this
/// module's `Entry` table.
enum EntryCopy {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Entry", bundle: .module)
  }
}
