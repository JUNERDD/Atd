import AtdAI
import AtdActions
import Foundation

/// Why an entry point stopped, in the words Siri, Shortcuts or a control shows. The system
/// shows them outside Atd, so their copy is in the main bundle's `EntryIntents` table.
public enum IntentFailure: Error, Equatable, CustomLocalizedStringResourceConvertible {
  /// The App Group's files cannot be opened.
  case unavailable
  /// The command was removed after a shortcut or a control was set up with it.
  case commandMissing
  /// 总结剪贴板, or a command reading the clipboard, found no text there.
  case emptyClipboard
  /// Atd may not read or add to the calendar or reminders; Settings › Apps › Atd can allow it.
  case denied(ProtectedData)
  /// There is no default calendar to add the event to.
  case noDefaultCalendar
  /// The expense has no amount or currency the ledger keeps.
  case invalidExpense
  /// The model's or the card's own line (`ModelFailure.message`, `CardFailure.message`).
  case model(String)

  /// What `error` means to the person running a command; nil for an error that is not Atd's
  /// (a cancellation, the system's own), which passes through as it is.
  public init?(_ error: any Error) {
    switch error {
    case let failure as IntentFailure: self = failure
    case let failure as ModelFailure: self = .model(failure.message)
    case let failure as CardFailure: self = .model(failure.message)
    case let failure as ActionError:
      switch failure {
      case .denied(let data): self = .denied(data)
      case .noDefaultCalendar: self = .noDefaultCalendar
      case .invalidExpense: self = .invalidExpense
      }
    default: return nil
    }
  }

  public var localizedStringResource: LocalizedStringResource {
    switch self {
    case .unavailable: LocalizedStringResource("failure.unavailable", table: "EntryIntents")
    case .commandMissing: LocalizedStringResource("failure.commandMissing", table: "EntryIntents")
    case .emptyClipboard: LocalizedStringResource("failure.emptyClipboard", table: "EntryIntents")
    case .denied(.calendar): LocalizedStringResource("failure.calendar", table: "EntryIntents")
    case .denied(.reminders): LocalizedStringResource("failure.reminders", table: "EntryIntents")
    case .noDefaultCalendar:
      LocalizedStringResource("failure.noDefaultCalendar", table: "EntryIntents")
    case .invalidExpense: LocalizedStringResource("failure.invalidExpense", table: "EntryIntents")
    case .model(let message): "\(message)"
    }
  }
}
