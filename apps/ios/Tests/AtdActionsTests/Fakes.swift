import AtdModel
import Foundation
import Synchronization
import Testing

@testable import AtdActions

/// Calendar as EventKit behaves, without the person's calendar: access changes only by asking,
/// and the person grants or declines as told; reading and removing need full access.
final class FakeCalendar: CalendarStore {
  private struct State {
    var access: DataAccess
    var grants: Bool
    var events: [AgendaEvent]
    /// Each request's `full`.
    var requests: [Bool] = []
    var added: [String: NewEvent] = [:]
    var failure: ActionError?
  }

  private let state: Mutex<State>

  init(_ access: DataAccess, grants: Bool = true, events: [AgendaEvent] = []) {
    state = Mutex(State(access: access, grants: grants, events: events))
  }

  var requests: [Bool] { state.withLock { $0.requests } }
  var added: [String: NewEvent] { state.withLock { $0.added } }

  /// Makes every later addition fail with `error`.
  func fail(with error: ActionError) {
    state.withLock { $0.failure = error }
  }

  var eventAccess: DataAccess { state.withLock { $0.access } }

  func requestEventAccess(full: Bool) async throws -> Bool {
    state.withLock { state in
      state.requests.append(full)
      switch state.access {
      case .full: return true
      case .writeOnly where !full: return true
      case .denied: return false
      case .notDetermined, .writeOnly:
        // Declining an upgrade keeps write-only access; declining the first prompt denies.
        if state.grants {
          state.access = full ? .full : .writeOnly
        } else if state.access == .notDetermined {
          state.access = .denied
        }
        return state.grants
      }
    }
  }

  func addEvent(_ event: NewEvent) async throws -> String {
    try state.withLock { state in
      if let failure = state.failure { throw failure }
      let identifier = "event-\(state.added.count + 1)"
      state.added[identifier] = event
      return identifier
    }
  }

  func removeEvent(_ identifier: String) async -> Bool {
    state.withLock { state in
      state.access == .full && state.added.removeValue(forKey: identifier) != nil
    }
  }

  /// In reverse order, since EventKit promises none.
  func events(in interval: DateInterval) async -> [AgendaEvent] {
    state.withLock { state in
      state.events.filter { $0.start < interval.end && interval.start < $0.end }.reversed()
    }
  }
}

/// Reminders as EventKit behaves: full access or none, given by asking once.
final class FakeReminders: ReminderStore {
  private struct State {
    var access: DataAccess
    var grants: Bool
    var reminders: [AgendaReminder]
    var requests = 0
    var added: [String: NewReminder] = [:]
    var failure: ActionError?
  }

  private let state: Mutex<State>

  init(_ access: DataAccess, grants: Bool = true, reminders: [AgendaReminder] = []) {
    state = Mutex(State(access: access, grants: grants, reminders: reminders))
  }

  var requests: Int { state.withLock { $0.requests } }
  var added: [String: NewReminder] { state.withLock { $0.added } }

  func fail(with error: ActionError) {
    state.withLock { $0.failure = error }
  }

  var reminderAccess: DataAccess { state.withLock { $0.access } }

  func requestReminderAccess() async throws -> Bool {
    state.withLock { state in
      state.requests += 1
      if state.access == .notDetermined { state.access = state.grants ? .full : .denied }
      return state.access == .full
    }
  }

  func addReminders(_ reminders: [NewReminder]) async throws -> [String] {
    try state.withLock { state in
      if let failure = state.failure { throw failure }
      return reminders.map { reminder in
        let identifier = "reminder-\(state.added.count + 1)"
        state.added[identifier] = reminder
        return identifier
      }
    }
  }

  func removeReminders(_ identifiers: [String]) async -> Bool {
    state.withLock { state in
      guard state.access == .full else { return false }
      return identifiers.map { state.added.removeValue(forKey: $0) != nil }.allSatisfy { $0 }
    }
  }

  /// In reverse order, since EventKit promises none.
  func incompleteReminders(dueBefore end: Date) async -> [AgendaReminder] {
    state.withLock { state in state.reminders.filter { $0.due < end }.reversed() }
  }
}

/// Counts the widget reloads a `LedgerBook` asks for.
final class WidgetReloads: Sendable {
  private let count = Mutex(0)

  var value: Int { count.withLock { $0 } }

  func reload() {
    count.withLock { $0 += 1 }
  }
}

/// Times in Shanghai, where the tests' days are.
enum Shanghai {
  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt
    return calendar
  }

  /// A moment of November 2026.
  static func at(_ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
    let parts = DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)
    return try #require(calendar.date(from: parts))
  }
}
