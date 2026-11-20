import AtdModel
import Foundation
import Testing

@testable import AtdIntents

struct NextItemTests {
  private func event(_ title: String, _ start: Date, _ end: Date, allDay: Bool = false)
    -> AgendaEvent
  {
    AgendaEvent(title: title, start: start, end: end, isAllDay: allDay)
  }

  @Test func showsTheEventOnNowUntilItEnds() {
    let meeting = event("Review", day(14), day(15))
    let later = event("Dinner", day(19), day(20))
    let item = NextItem.pick([meeting, later], at: day(14, 30), calendar: shanghai)
    #expect(item == NextItem(event: meeting, day: .today))
    #expect(NextItem.pick([meeting, later], at: day(15), calendar: shanghai)?.event == later)
  }

  @Test func prefersATimedEventTodayOverTheAllDayOne() {
    let holiday = event("Holiday", day(0), day(0, plusDays: 1), allDay: true)
    let call = event("Call", day(16), day(17))
    #expect(NextItem.pick([holiday, call], at: day(9), calendar: shanghai)?.event == call)
    #expect(NextItem.pick([holiday, call], at: day(18), calendar: shanghai)?.event == holiday)
  }

  @Test func namesTheDayOfALaterEvent() {
    let tomorrow = event("Flight", day(10, plusDays: 1), day(12, plusDays: 1))
    let friday = event("Party", day(20, plusDays: 6), day(22, plusDays: 6))
    #expect(NextItem.pick([tomorrow], at: day(21), calendar: shanghai)?.day == .tomorrow)
    #expect(NextItem.pick([friday], at: day(21), calendar: shanghai)?.day == .later)
    #expect(NextItem.pick([], at: day(21), calendar: shanghai) == nil)
  }

  @Test func changesAsEventsEndAndAtMidnight() {
    let events = [
      event("Past", day(8), day(9)), event("Review", day(14), day(15)),
      event("Dinner", day(19), day(20)),
    ]
    let changes = NextItem.changes(of: events, after: day(10), calendar: shanghai)
    #expect(changes == [day(15), day(20), day(0, plusDays: 1)])
    let many = (0..<20).map {
      event("E\($0)", day(11), day(11).addingTimeInterval(Double($0 + 1) * 60))
    }
    #expect(NextItem.changes(of: many, after: day(10), calendar: shanghai).count == 10)
  }

  @Test func looksFromTodayThroughAWeek() {
    let interval = NextItem.interval(around: day(14), calendar: shanghai)
    #expect(interval.start == day(0))
    #expect(interval.end == day(0, plusDays: NextItem.days + 1))
  }
}
