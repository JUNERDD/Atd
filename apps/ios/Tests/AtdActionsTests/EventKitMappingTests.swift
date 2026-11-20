import AtdModel
import EventKit
import Foundation
import Testing

@testable import AtdActions

/// What `EventKitStore` reads from EventKit without touching the person's data: authorization,
/// errors, and reminders built in memory.
@Suite struct EventKitMappingTests {
  @Test func authorizationReadsAsAccess() {
    #expect(DataAccess(EKAuthorizationStatus.notDetermined) == .notDetermined)
    #expect(DataAccess(EKAuthorizationStatus.writeOnly) == .writeOnly)
    #expect(DataAccess(EKAuthorizationStatus.fullAccess) == .full)
    #expect(DataAccess(EKAuthorizationStatus.denied) == .denied)
    #expect(DataAccess(EKAuthorizationStatus.restricted) == .denied)
  }

  /// Access taken away between the check and the save is denied like any other.
  @Test func notAuthorizedIsDenied() {
    let revoked = EventKitStore.translated(EKError(.eventStoreNotAuthorized), .reminders)
    #expect(revoked as? ActionError == .denied(.reminders))
    let readOnly = EventKitStore.translated(EKError(.calendarReadOnly), .calendar)
    #expect((readOnly as? EKError)?.code == .calendarReadOnly)
    let other = EventKitStore.translated(CocoaError(.fileWriteNoPermission), .calendar)
    #expect(other as? CocoaError == CocoaError(.fileWriteNoPermission))
  }

  @Test func onlyRemindersWithADueDateAreOnTheAgenda() throws {
    let store = EKEventStore()
    defer { withExtendedLifetime(store) {} }
    let reminder = EKReminder(eventStore: store)
    reminder.title = "买菜"
    #expect(AgendaReminder(reminder) == nil)
    var due = DateComponents(year: 2026, month: 11, day: 21)
    due.calendar = Shanghai.calendar
    reminder.dueDateComponents = due
    let day = try Shanghai.at(21)
    #expect(AgendaReminder(reminder) == AgendaReminder(title: "买菜", due: day, hasDueTime: false))
    due.hour = 19
    reminder.dueDateComponents = due
    #expect(
      AgendaReminder(reminder)
        == AgendaReminder(title: "买菜", due: try Shanghai.at(21, 19), hasDueTime: true))
  }
}
