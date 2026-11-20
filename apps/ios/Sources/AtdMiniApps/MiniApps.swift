import AtdModel
import Foundation

/// AI-built mini apps (小应用): their files, their sandboxed pages' bridge and the data their
/// native widgets draw. The app and the widget extension both link this module, so the widget
/// configuration intent and the widget buttons' intents live here too (`AtdIntentsPackage` has the
/// rule).
///
/// A mini app is a page the model wrote (HTML, CSS and script, run in a sandboxed web view with no
/// network) over data whose shape it also wrote (`MiniAppSchema`), plus a widget spec that picks one
/// of Atd's native widget templates and binds it to that data. The widget never runs the page's
/// code: it is drawn natively from the data (`MiniAppGlance`).
public enum MiniApps {
  /// The widget kind of every mini app's widget; the configuration intent picks the app.
  public static let widgetKind = "miniApp"

  /// The Darwin notification posted after a process changes a mini app's files, so an open page
  /// reloads its data.
  public static func changeNotificationName(for group: AppGroup) -> String {
    "\(group.identifier).miniapps.changed"
  }

  /// Built-in apps (`ledger`, `water`, `camp`) and generated ones (`app-` and ten letters or
  /// digits) both fit this.
  public static func isValidID(_ id: String) -> Bool {
    (1...40).contains(id.count)
      && id.unicodeScalars.allSatisfy { lowercase.contains($0) || digits.contains($0) || $0 == "-" }
  }

  /// A new generated app's id.
  public static func newID() -> String {
    let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return "app-" + String((0..<10).map { _ in alphabet.randomElement() ?? "a" })
  }

  private static let lowercase = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz")
  private static let digits = CharacterSet(charactersIn: "0123456789")
}

/// The limits every package, write and message is checked against. They keep a page small enough
/// to generate on a phone-sized output budget and a data file small enough for the widget
/// extension's memory.
public enum MiniAppLimits {
  public static let fields = 32
  public static let textLength = 500
  public static let records = 500
  /// Days a daily series keeps; older days are dropped on write.
  public static let days = 1_100
  public static let manifestBytes = 16 * 1_024
  public static let pageBytes = 128 * 1_024
  public static let dataBytes = 512 * 1_024
  public static let messageBytes = 64 * 1_024
  public static let nameLength = 24
  /// Short labels a widget template shows (unit, kicker, button).
  public static let labelLength = 16
  /// Versions kept on disk per app, the current one included.
  public static let versions = 5
}

/// Why a package, a value or a request was not accepted. `reason` is English and short: it goes
/// back to the model (a repair request) or to the page (a rejected promise), never to the person.
public struct MiniAppInvalid: Error, Sendable, Equatable, CustomStringConvertible {
  public var reason: String

  public init(_ reason: String) {
    self.reason = reason
  }

  public var description: String { reason }
}
