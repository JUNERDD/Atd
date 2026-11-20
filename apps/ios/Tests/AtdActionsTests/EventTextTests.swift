import AtdActions
import AtdModel
import Foundation
import Testing

@Suite struct EventTextTests {
  private static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt

  private func date(_ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = Self.zone
    return try #require(
      calendar.date(
        from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)))
  }

  /// 拷贝日程: one line each, the date in the event's own language.
  @Test func anEventCopiesAsTextInItsOwnLanguage() throws {
    let chinese = EventDraft(
      title: "城市读书会 · 11 月共读", start: try date(21, 14), end: try date(21, 16),
      location: "静安图书馆 3 楼多功能厅", alert: .hourBefore)
    let lines = chinese.plainText(timeZone: Self.zone).components(separatedBy: "\n")
    #expect(lines.count == 3)
    #expect(lines[0] == "城市读书会 · 11 月共读" && lines[2] == "静安图书馆 3 楼多功能厅")
    #expect(lines[1].contains("11月21日") && lines[1].contains("14:00") && lines[1].contains("16:00"))

    let english = EventDraft(
      title: "Product launch party at the city library", start: try date(21, 14), alert: .off)
    let text = english.plainText(timeZone: Self.zone)
    #expect(text.hasPrefix("Product launch party at the city library\n"))
    #expect(text.contains("Nov 21") && text.contains("2:00"))

    let days = EventDraft(
      title: "团建旅行", start: try date(21), end: try date(23), isAllDay: true,
      notes: "带身份证", alert: .off)
    let trip = days.plainText(timeZone: Self.zone).components(separatedBy: "\n")
    #expect(trip.count == 3 && trip[2] == "带身份证")
    #expect(trip[1].contains("21") && trip[1].contains("23") && !trip[1].contains(":"))
  }
}
