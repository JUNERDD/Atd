import AtdModel
import Foundation

/// Reads a day's agenda from Calendar and Reminders: today's for 今日简报, tomorrow's for an
/// automation, and the next events for the Lock Screen's 下一项. Reading needs full access to
/// each, and whatever one of them withholds is left out (`nil`) rather than failing the whole
/// agenda.
public struct TodayReader: Sendable {
  private let calendarStore: any CalendarStore
  private let reminderStore: any ReminderStore

  public init(
    calendarStore: any CalendarStore = EventKitStore.shared,
    reminderStore: any ReminderStore = EventKitStore.shared
  ) {
    self.calendarStore = calendarStore
    self.reminderStore = reminderStore
  }

  /// What Atd may do with the calendar or reminders now. It never asks the person, so widgets
  /// and background runs can skip what they may not read; reading needs `.full`.
  public func access(to data: ProtectedData) -> DataAccess {
    switch data {
    case .calendar: calendarStore.eventAccess
    case .reminders: reminderStore.reminderAccess
    }
  }

  /// Asks for full access to `data` unless Atd has it. The system prompts only where the person
  /// was never asked, and for the calendar also where Atd has write-only access.
  /// - Throws: `ActionError.denied(data)` when Atd still may not read it, or the system's error.
  public func requestAccess(to data: ProtectedData) async throws {
    guard try await grant(data) else { throw ActionError.denied(data) }
  }

  /// The agenda of the day of `day`: the events that overlap it, and the incomplete reminders
  /// due by its end, overdue ones included.
  /// - Parameter asking: whether to ask for access as `requestAccess(to:)` does. Widgets, Live
  ///   Activities and automations running in the background pass false and read only what they
  ///   already may.
  /// - Throws: `ActionError.denied(.calendar)` when neither the calendar nor reminders can be
  ///   read, or the system's error from asking.
  public func agenda(for day: Date = .now, calendar: Calendar = .current, asking: Bool = true)
    async throws -> Agenda
  {
    let start = calendar.startOfDay(for: day)
    let interval =
      calendar.dateInterval(of: .day, for: start) ?? DateInterval(start: start, duration: 86_400)
    var events: [AgendaEvent]?
    if try await mayRead(.calendar, asking: asking) {
      events = await sortedEvents(in: interval)
    }
    var reminders: [AgendaReminder]?
    if try await mayRead(.reminders, asking: asking) {
      reminders = await reminderStore.incompleteReminders(dueBefore: interval.end).sorted {
        ($0.due, $0.title) < ($1.due, $1.title)
      }
    }
    guard events != nil || reminders != nil else { throw ActionError.denied(.calendar) }
    return Agenda(day: start, events: events, reminders: reminders)
  }

  /// The events that overlap `interval`, soonest first, for what looks beyond one day, such as
  /// 下一项 over the next few days. It never asks; nil without full calendar access.
  public func events(in interval: DateInterval) async -> [AgendaEvent]? {
    access(to: .calendar) == .full ? await sortedEvents(in: interval) : nil
  }

  private func sortedEvents(in interval: DateInterval) async -> [AgendaEvent] {
    await calendarStore.events(in: interval).sorted { ($0.start, $0.title) < ($1.start, $1.title) }
  }

  private func mayRead(_ data: ProtectedData, asking: Bool) async throws -> Bool {
    asking ? try await grant(data) : access(to: data) == .full
  }

  /// Whether Atd may read `data`, asking first where the system still can.
  private func grant(_ data: ProtectedData) async throws -> Bool {
    switch access(to: data) {
    case .full:
      true
    case .denied:
      false
    case .notDetermined, .writeOnly:
      switch data {
      case .calendar: try await calendarStore.requestEventAccess(full: true)
      case .reminders: try await reminderStore.requestReminderAccess()
      }
    }
  }
}
