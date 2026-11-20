import AtdModel
import Foundation

/// Reminders as the actions use them. `EventKitStore` is the real one; tests and previews use
/// their own, so the logic runs without the person's permission.
public protocol ReminderStore: Sendable {
  var reminderAccess: DataAccess { get }
  /// Asks for full access, the only kind Reminders grants; returns whether it was granted. The
  /// system shows its prompt only the first time.
  func requestReminderAccess() async throws -> Bool
  /// Adds the reminders to the default list, all or none, and returns their identifiers in order.
  func addReminders(_ reminders: [NewReminder]) async throws -> [String]
  /// Removes the reminders; returns whether every one of them is gone.
  func removeReminders(_ identifiers: [String]) async -> Bool
  /// The incomplete reminders due before `end`, overdue ones included, in no particular order.
  func incompleteReminders(dueBefore end: Date) async -> [AgendaReminder]
}

/// A reminder as Reminders stores it.
public struct NewReminder: Sendable, Equatable {
  public var title: String
  public var notes: String?

  public init(title: String, notes: String? = nil) {
    self.title = title
    self.notes = notes
  }

  /// The reminder a to-do makes: its text as the title, and whom it is assigned to as the note.
  /// Nil for a to-do without text.
  public init?(_ todo: NotesCard.Todo) {
    let title = todo.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return nil }
    let owner = todo.owner?.trimmingCharacters(in: .whitespacesAndNewlines)
    self.init(title: title, notes: owner?.isEmpty == false ? owner : nil)
  }
}

/// Adds organized to-dos to the person's reminders (整理白板 → 加到提醒事项). Reminders grants
/// only full access, so that is what it asks for.
public struct ReminderWriter: Sendable {
  private let store: any ReminderStore

  public init(store: any ReminderStore = EventKitStore.shared) {
    self.store = store
  }

  /// Whether adding can work without asking (`.full`), needs asking first, or needs Settings.
  public var access: DataAccess { store.reminderAccess }

  /// Adds one reminder per to-do to the default list, asking for access the first time. To-dos
  /// without text are skipped. Returns the reminders' identifiers, which `remove(ids:)` takes.
  /// - Throws: `ActionError.denied(.reminders)` when access is off or the person declines now,
  ///   `ActionError.noDefaultCalendar(.reminders)`, or Reminders' own error; then none was added.
  public func add(_ todos: [NotesCard.Todo]) async throws -> [String] {
    let reminders = todos.compactMap(NewReminder.init)
    guard !reminders.isEmpty else { return [] }
    switch store.reminderAccess {
    case .full:
      break
    case .notDetermined:
      guard try await store.requestReminderAccess() else { throw ActionError.denied(.reminders) }
    case .denied, .writeOnly:
      throw ActionError.denied(.reminders)
    }
    return try await store.addReminders(reminders)
  }

  /// Takes back reminders `add` added (撤销); returns whether every one is gone. Reminders
  /// access is always full, so this works whenever adding did.
  public func remove(ids: [String]) async -> Bool {
    await store.removeReminders(ids)
  }
}
