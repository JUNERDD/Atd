import AtdActions
import AtdModel
import Foundation
import UIKit

/// How a calendar or reminders action ended, as a card shows it.
enum CameraActionOutcome<Done: Equatable>: Equatable {
  case done(Done)
  /// Access is off: the card offers 拷贝 and 去设置 instead.
  case denied
  case failed(String)
}

/// The camera's real actions, on the shared owners (`LedgerBook`, `CalendarWriter`,
/// `ReminderWriter`): each turns their errors into what a card shows.
struct CameraActions {
  let store: SharedStore

  /// 记入「记账本」. `LedgerBook` refreshes the widgets after every write.
  func record(_ draft: ExpenseDraft) -> CameraActionOutcome<Expense> {
    do {
      return .done(try LedgerBook(store: store).add(draft, source: .camera))
    } catch {
      return .failed(CameraCopy.string("camera.saveFailed"))
    }
  }

  /// 撤销 for an expense just recorded.
  func unrecord(_ expense: Expense) -> Bool {
    (try? LedgerBook(store: store).remove(id: expense.id)) ?? false
  }

  /// 添加到日历: asks for add-only access the first time. The addition can be undone only with
  /// full access.
  func addEvent(_ draft: EventDraft) async -> CameraActionOutcome<CalendarAddition> {
    do {
      return .done(try await CalendarWriter().add(draft))
    } catch {
      return Self.outcome(of: error)
    }
  }

  func removeEvent(_ addition: CalendarAddition) async -> Bool {
    await CalendarWriter().remove(addition)
  }

  /// 加到提醒事项: one reminder per to-do; the identifiers undo it.
  func addReminders(_ todos: [NotesCard.Todo]) async -> CameraActionOutcome<[String]> {
    do {
      return .done(try await ReminderWriter().add(todos))
    } catch {
      return Self.outcome(of: error)
    }
  }

  func removeReminders(_ ids: [String]) async -> Bool {
    await ReminderWriter().remove(ids: ids)
  }

  static func copy(_ text: String) {
    UIPasteboard.general.string = text
  }

  /// Atd's page in Settings, where the person turns access back on.
  static var settingsURL: URL? { URL(string: UIApplication.openSettingsURLString) }

  private static func outcome<Done>(of error: any Error) -> CameraActionOutcome<Done> {
    switch error as? ActionError {
    case .denied: .denied
    case .noDefaultCalendar: .failed(CameraCopy.string("camera.noDefault"))
    case .invalidExpense, nil: .failed(CameraCopy.string("camera.saveFailed"))
    }
  }
}
