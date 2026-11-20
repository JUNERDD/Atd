import AtdAI
import AtdActions
import AtdModel
import Foundation

/// Why a run produced no result, in the one line its screen shows.
enum ShareFailure: Equatable {
  case model(ModelFailure)
  /// The content has nothing of the card's kind (no event on the page).
  case nothingFound(CardKind)
  case page(PageFailure)
  case other

  init(_ error: any Error) {
    switch error {
    case let failure as ModelFailure: self = .model(failure)
    case let failure as CardFailure:
      switch failure {
      case .nothingFound(let kind): self = .nothingFound(kind)
      }
    case let failure as PageFailure: self = .page(failure)
    default: self = .other
    }
  }

  var message: String {
    switch self {
    case .model(let failure): failure.message
    case .nothingFound(let kind): CardFailure.nothingFound(kind).message
    case .page(.offline): ModelFailure.offline.message
    case .page(.unreadable): String(localized: "failure.page", bundle: .module)
    case .other: String(localized: "failure.other", bundle: .module)
    }
  }

  /// Whether running again as it is can work: not when the content has nothing to find, nor for
  /// what only a change in Atd's settings fixes.
  var canRetry: Bool {
    switch self {
    case .model(let failure): failure.canRetry
    case .nothingFound: false
    case .page, .other: true
    }
  }
}

/// What kept a card's action from happening; its card says so in its one footnote.
enum CardIssue: Equatable {
  /// Atd may not add to the calendar or reminders; only Settings can change that.
  case denied(ProtectedData)
  /// There is no default calendar or reminders list to add to.
  case noDefault(ProtectedData)
  /// The calendar, reminders or ledger did not take it.
  case notSaved(CardKind)

  init(_ error: any Error, kind: CardKind) {
    switch error as? ActionError {
    case .denied(let data): self = .denied(data)
    case .noDefaultCalendar(let data): self = .noDefault(data)
    case .invalidExpense, nil: self = .notSaved(kind)
    }
  }

  var message: String {
    switch self {
    case .denied(.calendar): String(localized: "issue.calendarDenied", bundle: .module)
    case .denied(.reminders): String(localized: "issue.remindersDenied", bundle: .module)
    case .noDefault(.calendar): String(localized: "issue.noCalendar", bundle: .module)
    case .noDefault(.reminders): String(localized: "issue.noList", bundle: .module)
    case .notSaved(.event): String(localized: "issue.eventNotAdded", bundle: .module)
    case .notSaved(.expense): String(localized: "issue.expenseNotLogged", bundle: .module)
    case .notSaved: String(localized: "issue.remindersNotAdded", bundle: .module)
    }
  }
}
