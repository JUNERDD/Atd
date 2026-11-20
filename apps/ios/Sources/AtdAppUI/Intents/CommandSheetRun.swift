import AtdAI
import AtdActions
import AtdIntents
import AtdModel
import Foundation
import UIKit

/// One run of the run sheet: the command on the clipboard, or on nothing for a command that reads
/// nothing; its card; and what the card's action did.
@Observable
final class CommandSheetRun {
  enum Phase {
    case working
    case done(CardResult)
    case failed(Problem)
  }

  /// Why the run or its action stopped, and the one thing that helps.
  struct Problem: Equatable {
    enum Remedy: Equatable {
      case retry, addModel, settings
    }

    let message: String
    let remedy: Remedy?
  }

  /// What the card's action has done.
  enum Outcome: Equatable {
    case copied, added
    case logged(String)
  }

  private(set) var phase = Phase.working
  private(set) var outcome: Outcome?
  /// A failure of the card's action (adding, logging), shown under the card.
  private(set) var actionProblem: Problem?

  /// Runs `command`, reading the clipboard first when it reads text; the system asks the person
  /// before Atd reads another app's clipboard.
  func start(_ command: Command, context: EntryContext, onFailure: (ModelFailure) -> Void) async {
    phase = .working
    outcome = nil
    actionProblem = nil
    let text = command.input == .none ? "" : UIPasteboard.general.string ?? ""
    guard CommandInputNeed(command.input, text: text, hasImage: false) == .ready else {
      phase = .failed(Self.problem(for: IntentFailure.emptyClipboard))
      return
    }
    do {
      let card = try await CommandRun(context).card(command, text: text, asking: true)
      phase = .done(card)
    } catch is CancellationError {
      return
    } catch {
      if let failure = error as? ModelFailure { onFailure(failure) }
      phase = .failed(Self.problem(for: error))
    }
  }

  /// 拷贝: the card as text.
  func copy(_ card: CardResult) {
    UIPasteboard.general.string = CardText.text(card)
    outcome = .copied
  }

  /// 添加到日历, asking for write-only access the first time.
  func add(_ draft: EventDraft) async {
    do {
      _ = try await CalendarWriter().add(draft)
      outcome = .added
      actionProblem = nil
    } catch {
      actionProblem = Self.problem(for: error)
    }
  }

  /// 记入「book」.
  func log(_ draft: ExpenseDraft, store: SharedStore) {
    do {
      try LedgerBook(store: store).add(draft, source: .intent)
      outcome = .logged(draft.book)
      actionProblem = nil
    } catch {
      actionProblem = Self.problem(for: error)
    }
  }

  static func problem(for error: any Error) -> Problem {
    switch error {
    case ModelFailure.noModel:
      Problem(message: ModelFailure.noModel.message, remedy: .addModel)
    case let failure as ModelFailure:
      Problem(message: failure.message, remedy: failure.canRetry ? .retry : nil)
    default:
      if let failure = IntentFailure(error) {
        Problem(
          message: String(localized: failure.localizedStringResource), remedy: remedy(failure))
      } else {
        // Not Atd's own failure: trying again is all there is.
        Problem(message: ModelFailure.timedOut.message, remedy: .retry)
      }
    }
  }

  private static func remedy(_ failure: IntentFailure) -> Problem.Remedy? {
    switch failure {
    case .denied: .settings
    case .emptyClipboard: .retry
    case .unavailable, .commandMissing, .noDefaultCalendar, .invalidExpense, .model: nil
    }
  }
}
