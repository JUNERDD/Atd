import AtdModel
import Foundation
import Testing

@testable import AtdActions

@Suite struct CalendarWriterTests {
  private func draft() throws -> EventDraft {
    EventDraft(
      title: "城市读书会", start: try Shanghai.at(28, 14), location: "静安图书馆", alert: .hourBefore)
  }

  private func writer(_ store: FakeCalendar) -> CalendarWriter {
    CalendarWriter(store: store, calendar: Shanghai.calendar)
  }

  /// Write-only access is all adding asks for, and it cannot take the event back (A14).
  @Test func theFirstAdditionAsksForWriteOnlyAccess() async throws {
    let store = FakeCalendar(.notDetermined)
    let writer = writer(store)
    let addition = try await writer.add(try draft())
    #expect(store.requests == [false] && writer.access == .writeOnly)
    #expect(!addition.canRemove)
    #expect(store.added[addition.identifier] == NewEvent(try draft(), calendar: Shanghai.calendar))
    #expect(await !writer.remove(addition))
    #expect(store.added.count == 1)

    _ = try await writer.add(try draft())
    #expect(store.requests == [false] && store.added.count == 2)
  }

  @Test func withFullAccessAnAdditionCanBeTakenBack() async throws {
    let store = FakeCalendar(.full)
    let writer = writer(store)
    let addition = try await writer.add(try draft())
    #expect(addition.canRemove && store.requests.isEmpty)
    #expect(await writer.remove(addition))
    #expect(store.added.isEmpty)
    #expect(await !writer.remove(addition))
  }

  @Test(arguments: [(DataAccess.denied, true), (.notDetermined, false)])
  func withoutAccessAddingIsDenied(_ access: DataAccess, grants: Bool) async throws {
    let store = FakeCalendar(access, grants: grants)
    let draft = try draft()
    await #expect(throws: ActionError.denied(.calendar)) { try await writer(store).add(draft) }
    #expect(store.added.isEmpty)
    #expect(store.requests == (access == .notDetermined ? [false] : []))
  }

  @Test func calendarsErrorsComeThrough() async throws {
    let store = FakeCalendar(.writeOnly)
    store.fail(with: .noDefaultCalendar(.calendar))
    let draft = try draft()
    await #expect(throws: ActionError.noDefaultCalendar(.calendar)) {
      try await writer(store).add(draft)
    }
  }

  @Test func aTimedEventLastsAnHourAndAlertsBeforeItStarts() throws {
    let start = try Shanghai.at(28, 14)
    let event = { (alert: EventAlert, end: Date?) in
      NewEvent(
        EventDraft(title: "读书会", start: start, end: end, notes: "带书", alert: alert),
        calendar: Shanghai.calendar)
    }
    #expect(
      event(.hourBefore, nil)
        == NewEvent(
          title: "读书会", start: start, end: try Shanghai.at(28, 15), isAllDay: false,
          notes: "带书", alarmOffset: -3600))
    #expect(event(.off, nil).alarmOffset == nil)
    #expect(event(.dayBefore, nil).alarmOffset == -86_400)
    #expect(event(.off, try Shanghai.at(28, 17)).end == (try Shanghai.at(28, 17)))
  }

  /// All-day alerts follow Calendar's own: 9:00 the day before, or 9:00 on the day.
  @Test func anAllDayEventCoversItsDaysAndAlertsInTheMorning() throws {
    let hour: TimeInterval = 60 * 60
    let trip = NewEvent(
      EventDraft(
        title: "团建", start: try Shanghai.at(28, 10), end: try Shanghai.at(29, 18), isAllDay: true,
        alert: .dayBefore),
      calendar: Shanghai.calendar)
    #expect(try trip.start == Shanghai.at(28) && trip.end == Shanghai.at(29))
    #expect(trip.isAllDay && trip.alarmOffset == -15 * hour)
    let day = NewEvent(
      EventDraft(title: "体检", start: try Shanghai.at(1), isAllDay: true, alert: .hourBefore),
      calendar: Shanghai.calendar)
    #expect(try day.start == Shanghai.at(1) && day.end == day.start)
    #expect(day.alarmOffset == 9 * hour)
  }
}
