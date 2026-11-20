import AtdModel
import Foundation
import Testing

@testable import AtdActions

@Suite struct TodayReaderTests {
  /// A night shift into Saturday the 21st, an all-day outing, two meetings starting together,
  /// and a book club on Sunday.
  private func events() throws -> [AgendaEvent] {
    [
      AgendaEvent(
        title: "夜班", start: try Shanghai.at(20, 22), end: try Shanghai.at(21, 6), isAllDay: false),
      AgendaEvent(
        title: "产品周会", start: try Shanghai.at(21, 15), end: try Shanghai.at(21, 16),
        isAllDay: false, location: "3 楼会议室"),
      AgendaEvent(
        title: "团建", start: try Shanghai.at(21), end: try Shanghai.at(22), isAllDay: true),
      AgendaEvent(
        title: "Bug 评审", start: try Shanghai.at(21, 15), end: try Shanghai.at(21, 15, 30),
        isAllDay: false),
      AgendaEvent(
        title: "读书会", start: try Shanghai.at(22, 14), end: try Shanghai.at(22, 16),
        isAllDay: false),
    ]
  }

  /// One overdue since the 15th, two due on the 21st, one on the 22nd.
  private func reminders() throws -> [AgendaReminder] {
    [
      AgendaReminder(title: "取快递", due: try Shanghai.at(21, 19), hasDueTime: true),
      AgendaReminder(title: "报销单", due: try Shanghai.at(15), hasDueTime: false),
      AgendaReminder(title: "交房租", due: try Shanghai.at(22, 9), hasDueTime: true),
      AgendaReminder(title: "买菜", due: try Shanghai.at(21), hasDueTime: false),
    ]
  }

  private func reader(_ calendar: FakeCalendar, _ reminders: FakeReminders) -> TodayReader {
    TodayReader(calendarStore: calendar, reminderStore: reminders)
  }

  @Test func aDaysAgendaHoldsWhatOverlapsItInOrder() async throws {
    let reader = reader(
      FakeCalendar(.full, events: try events()), FakeReminders(.full, reminders: try reminders()))
    let saturday = try await reader.agenda(
      for: try Shanghai.at(21, 10), calendar: Shanghai.calendar)
    #expect(saturday.day == (try Shanghai.at(21)))
    #expect(saturday.events?.map(\.title) == ["夜班", "团建", "Bug 评审", "产品周会"])
    #expect(saturday.reminders?.map(\.title) == ["报销单", "买菜", "取快递"])

    // Tomorrow, for an automation: Sunday's events, and every reminder due by its end.
    let sunday = try await reader.agenda(for: try Shanghai.at(22, 8), calendar: Shanghai.calendar)
    #expect(try sunday.day == Shanghai.at(22) && sunday.events?.map(\.title) == ["读书会"])
    #expect(sunday.reminders?.map(\.title) == ["报销单", "买菜", "取快递", "交房租"])
  }

  /// Widgets and background runs read only what they already may.
  @Test func withoutAskingNothingIsAsked() async throws {
    let calendar = FakeCalendar(.notDetermined, events: try events())
    let reader = reader(calendar, FakeReminders(.full, reminders: try reminders()))
    #expect(reader.access(to: .calendar) == .notDetermined)
    #expect(reader.access(to: .reminders) == .full)
    let agenda = try await reader.agenda(
      for: try Shanghai.at(21), calendar: Shanghai.calendar, asking: false)
    #expect(agenda.events == nil && agenda.reminders?.count == 3)
    #expect(calendar.requests.isEmpty)
  }

  @Test func askingUpgradesWriteOnlyCalendarAccess() async throws {
    let calendar = FakeCalendar(.writeOnly, events: try events())
    let reminders = FakeReminders(.notDetermined, grants: false)
    let agenda = try await reader(calendar, reminders).agenda(
      for: try Shanghai.at(21), calendar: Shanghai.calendar)
    #expect(calendar.requests == [true] && agenda.events?.count == 4)
    #expect(reminders.requests == 1 && agenda.reminders == nil)
  }

  @Test func nothingReadableIsDenied() async {
    let reader = reader(FakeCalendar(.denied), FakeReminders(.notDetermined))
    await #expect(throws: ActionError.denied(.calendar)) {
      try await reader.agenda(asking: false)
    }
  }

  @Test func requestingAccessAsksOnlyWhereTheSystemStillCan() async throws {
    let calendar = FakeCalendar(.writeOnly)
    let reminders = FakeReminders(.denied)
    let reader = reader(calendar, reminders)
    try await reader.requestAccess(to: .calendar)
    try await reader.requestAccess(to: .calendar)
    #expect(calendar.requests == [true] && reader.access(to: .calendar) == .full)
    await #expect(throws: ActionError.denied(.reminders)) {
      try await reader.requestAccess(to: .reminders)
    }
    #expect(reminders.requests == 0)
    let declined = TodayReader(
      calendarStore: FakeCalendar(.notDetermined, grants: false), reminderStore: reminders)
    await #expect(throws: ActionError.denied(.calendar)) {
      try await declined.requestAccess(to: .calendar)
    }
  }

  /// 下一项 over the next days: full access only, and never a prompt.
  @Test func eventsAheadNeedFullAccess() async throws {
    let week = DateInterval(start: try Shanghai.at(21, 14), end: try Shanghai.at(28))
    let full = reader(FakeCalendar(.full, events: try events()), FakeReminders(.denied))
    #expect(
      await full.events(in: week)?.map(\.title) == ["团建", "Bug 评审", "产品周会", "读书会"])
    let writeOnly = FakeCalendar(.writeOnly, events: try events())
    #expect(await reader(writeOnly, FakeReminders(.full)).events(in: week) == nil)
    #expect(writeOnly.requests.isEmpty)
  }
}
